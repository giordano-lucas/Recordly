/**
 * Finds secrets (API keys, tokens, passwords) in OCR output of a recording and
 * turns them into time spans to blur. Boxes are normalized to the source frame
 * with a top-left origin: [x, y, width, height].
 */

export type NormalizedBox = [number, number, number, number];

export interface ScannedToken {
	text: string;
	box: NormalizedBox;
}

export interface ScannedFrame {
	/** Source media time in milliseconds. */
	t: number;
	tokens: ScannedToken[];
}

export type SensitiveReason = "known-format" | "labelled" | "high-entropy";

export interface SensitiveDetection {
	box: NormalizedBox;
	reason: SensitiveReason;
}

export interface SensitiveSpan {
	startMs: number;
	endMs: number;
	box: NormalizedBox;
	reason: SensitiveReason;
}

const KNOWN_SECRET_FORMATS: RegExp[] = [
	/^sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}$/, // OpenAI, Anthropic
	/^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}$/, // Stripe
	/^gh[pousr]_[A-Za-z0-9]{30,}$/, // GitHub
	/^github_pat_[A-Za-z0-9_]{30,}$/,
	/^glpat-[A-Za-z0-9_-]{20,}$/, // GitLab
	/^xox[abposr]-[A-Za-z0-9-]{10,}$/, // Slack
	/^(?:AKIA|ASIA)[A-Z0-9]{16}$/, // AWS access key id
	/^AIza[A-Za-z0-9_-]{30,}$/, // Google API key
	/^(?:npm|hf|pypi)_[A-Za-z0-9-]{30,}$/,
	/^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{4,}/, // JWT (OCR may cut the signature)
];

/** A label right before a value, e.g. "Password:" or "API_KEY=". */
const SECRET_LABEL =
	/(?:^|[^a-z])(?:pass(?:word|phrase)?|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?|client[_-]?secret)$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASKED = /^[•*●·.]+$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const NOT_SECRET_VALUES = new Set(["bearer", "basic", "token", "none", "null", "true", "false"]);

/** Characters around a value that OCR keeps: quotes, brackets, separators. */
function trimValue(text: string): { value: string; offset: number } {
	const match = /^[\s"'`([{<,;]*(.*?)[\s"'`)\]}>,;.]*$/.exec(text);
	const value = match?.[1] ?? text;
	return { value, offset: text.indexOf(value) };
}

export function shannonEntropy(text: string): number {
	const counts = new Map<string, number>();
	for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
	let entropy = 0;
	for (const count of counts.values()) {
		const p = count / text.length;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

function looksRandom(value: string): boolean {
	if (value.length < 24 || value.includes("://") || UUID.test(value)) return false;
	if (EMAIL.test(value) || (value.match(/\//g)?.length ?? 0) >= 2) return false;
	if (/^[0-9a-f]{32,}$/i.test(value)) return true; // hex digests and keys
	const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
		re.test(value),
	).length;
	return classes >= 3 && /[0-9]/.test(value) && shannonEntropy(value) >= 3.8;
}

/**
 * Why a single OCR token is a secret, or null. `previousText` is the token
 * before it on screen, which may be a label such as "Password:".
 */
export function classifySensitiveValue(
	value: string,
	previousText: string | null,
): SensitiveReason | null {
	if (value.length < 4 || MASKED.test(value)) return null;
	if (KNOWN_SECRET_FORMATS.some((format) => format.test(value))) return "known-format";
	const label = previousText?.replace(/[:=]+$/, "") ?? "";
	if (
		previousText &&
		/[:=]$/.test(previousText) &&
		SECRET_LABEL.test(label) &&
		!NOT_SECRET_VALUES.has(value.toLowerCase())
	) {
		return "labelled";
	}
	return looksRandom(value) ? "high-entropy" : null;
}

/** Narrows a token box to a character range, assuming roughly even glyph widths. */
function sliceBox(box: NormalizedBox, text: string, start: number, length: number): NormalizedBox {
	if (text.length === 0) return box;
	const [x, y, width, height] = box;
	return [x + (width * start) / text.length, y, (width * length) / text.length, height];
}

export function detectSensitiveTokens(tokens: ScannedToken[]): SensitiveDetection[] {
	const detections: SensitiveDetection[] = [];
	let previousText: string | null = null;
	for (const token of tokens) {
		const { value, offset } = trimValue(token.text);
		let reason: SensitiveReason | null = null;
		let start = offset;
		let length = value.length;
		// KEY=value in one token: classify the value with its key as the label,
		// and blur only the value.
		const assignment = /^([A-Za-z_][\w.-]*[:=])(.+)$/.exec(value);
		if (assignment) {
			const [, key, rest] = assignment;
			const inner = trimValue(rest);
			reason = classifySensitiveValue(inner.value, key);
			if (reason) {
				start = offset + key.length + inner.offset;
				length = inner.value.length;
			}
		}
		reason ??= classifySensitiveValue(value, previousText);
		if (reason) {
			detections.push({ box: sliceBox(token.box, token.text, start, length), reason });
		}
		previousText = value;
	}
	return detections;
}

function intersectionOverUnion(a: NormalizedBox, b: NormalizedBox): number {
	const left = Math.max(a[0], b[0]);
	const top = Math.max(a[1], b[1]);
	const right = Math.min(a[0] + a[2], b[0] + b[2]);
	const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
	const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
	const union = a[2] * a[3] + b[2] * b[3] - intersection;
	return union > 0 ? intersection / union : 0;
}

function unionBox(a: NormalizedBox, b: NormalizedBox): NormalizedBox {
	const left = Math.min(a[0], b[0]);
	const top = Math.min(a[1], b[1]);
	return [
		left,
		top,
		Math.max(a[0] + a[2], b[0] + b[2]) - left,
		Math.max(a[1] + a[3], b[1] + b[3]) - top,
	];
}

/** Grows a box so glyph edges and OCR jitter stay covered. */
export function padBox(box: NormalizedBox): NormalizedBox {
	const [x, y, width, height] = box;
	const padX = Math.max(0.004, height * 0.25);
	const padY = height * 0.3;
	const left = Math.max(0, x - padX);
	const top = Math.max(0, y - padY);
	return [left, top, Math.min(1, x + width + padX) - left, Math.min(1, y + height + padY) - top];
}

/**
 * Follows each detection across consecutive samples while it stays in place,
 * and returns one padded span per run. A secret may appear right after the
 * last sample without it and stay until right before the next one, so each run
 * extends a full sample interval on both sides: over-blurring beats a leak.
 */
export function buildSensitiveSpans(
	frames: ScannedFrame[],
	intervalMs: number,
	durationMs: number,
): SensitiveSpan[] {
	type Track = { firstT: number; lastT: number; box: NormalizedBox; reason: SensitiveReason };
	const finished: Track[] = [];
	let open: Track[] = [];
	const sorted = [...frames].sort((left, right) => left.t - right.t);
	for (const frame of sorted) {
		const continuing: Track[] = [];
		for (const detection of detectSensitiveTokens(frame.tokens)) {
			const index = open.findIndex(
				(track) =>
					frame.t - track.lastT <= intervalMs * 2.5 &&
					intersectionOverUnion(track.box, detection.box) >= 0.3,
			);
			if (index >= 0) {
				const [track] = open.splice(index, 1);
				continuing.push({
					...track,
					lastT: frame.t,
					box: unionBox(track.box, detection.box),
				});
			} else {
				continuing.push({
					firstT: frame.t,
					lastT: frame.t,
					box: detection.box,
					reason: detection.reason,
				});
			}
		}
		// Tracks not seen in this frame stay open briefly to bridge OCR misses.
		const stillOpen = open.filter((track) => frame.t - track.lastT <= intervalMs * 2.5);
		finished.push(...open.filter((track) => !stillOpen.includes(track)));
		open = [...continuing, ...stillOpen];
	}
	finished.push(...open);
	return finished
		.map((track) => ({
			startMs: Math.max(0, Math.round(track.firstT - intervalMs)),
			endMs: Math.min(durationMs, Math.round(track.lastT + intervalMs)),
			box: padBox(track.box),
			reason: track.reason,
		}))
		.filter((span) => span.endMs > span.startMs)
		.sort((left, right) => left.startMs - right.startMs);
}
