import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
} from "./types";

export type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

export type EditorHistoryStack = {
	past: EditorHistorySnapshot[];
	current: EditorHistorySnapshot | null;
	future: EditorHistorySnapshot[];
	/** Uncloned input of the last record call, used to skip deep compares of untouched arrays. */
	lastSource: EditorHistorySnapshot | null;
};

const DOCUMENT_KEYS = [
	"zoomRegions",
	"clipRegions",
	"speedRegions",
	"annotationRegions",
	"audioRegions",
	"autoCaptions",
] as const satisfies readonly (keyof EditorHistorySnapshot)[];

const SELECTION_KEYS = [
	"selectedZoomId",
	"selectedClipId",
	"selectedAnnotationId",
	"selectedAudioId",
] as const satisfies readonly (keyof EditorHistorySnapshot)[];

export type EditorHistoryRecordResult = "initialized" | "applied" | "recorded" | "unchanged";

export const MAX_EDITOR_HISTORY_ENTRIES = 100;

export function createEditorHistoryStack(): EditorHistoryStack {
	return {
		past: [],
		current: null,
		future: [],
		lastSource: null,
	};
}

export function resetEditorHistoryStack(stack: EditorHistoryStack): void {
	stack.past = [];
	stack.current = null;
	stack.future = [];
	stack.lastSource = null;
}

export function cloneEditorHistorySnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
	return globalThis.structuredClone(snapshot);
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		return left.every((value, index) => areDeepEqual(value, right[index]));
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => key in right && areDeepEqual(left[key], right[key]));
}

export function areEditorHistorySnapshotsEqual(
	left: EditorHistorySnapshot,
	right: EditorHistorySnapshot,
): boolean {
	return areDeepEqual(left, right);
}

function isDocumentUnchanged(stack: EditorHistoryStack, snapshot: EditorHistorySnapshot): boolean {
	const current = stack.current;
	if (!current) return false;
	return DOCUMENT_KEYS.every((key) => {
		// React state is replaced, not mutated: an identical reference cannot have changed.
		if (stack.lastSource && stack.lastSource[key] === snapshot[key]) return true;
		return areDeepEqual(current[key], snapshot[key]);
	});
}

/**
 * Records a timeline edit. Selection is carried along so undo restores what was
 * selected, but selecting something on its own is never an undo step.
 */
export function recordEditorHistorySnapshot(
	stack: EditorHistoryStack,
	snapshot: EditorHistorySnapshot,
	options: {
		applyingHistory?: boolean;
		maxEntries?: number;
	} = {},
): EditorHistoryRecordResult {
	if (!stack.current) {
		stack.current = cloneEditorHistorySnapshot(snapshot);
		stack.lastSource = snapshot;
		return "initialized";
	}

	if (options.applyingHistory) {
		stack.current = cloneEditorHistorySnapshot(snapshot);
		stack.lastSource = snapshot;
		return "applied";
	}

	if (isDocumentUnchanged(stack, snapshot)) {
		for (const key of SELECTION_KEYS) stack.current[key] = snapshot[key];
		stack.lastSource = snapshot;
		return "unchanged";
	}

	// stack.current is already a private clone, so it can move to the past as-is.
	stack.past.push(stack.current);
	const maxEntries = options.maxEntries ?? MAX_EDITOR_HISTORY_ENTRIES;
	if (stack.past.length > maxEntries) {
		stack.past.shift();
	}

	stack.current = cloneEditorHistorySnapshot(snapshot);
	stack.lastSource = snapshot;
	stack.future = [];
	return "recorded";
}

export function undoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.past.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const previous = stack.past.pop();
	if (!previous) {
		return null;
	}

	stack.future.push(cloneEditorHistorySnapshot(current));
	stack.current = cloneEditorHistorySnapshot(previous);
	stack.lastSource = null;
	return cloneEditorHistorySnapshot(previous);
}

export function redoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.future.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const next = stack.future.pop();
	if (!next) {
		return null;
	}

	stack.past.push(cloneEditorHistorySnapshot(current));
	stack.current = cloneEditorHistorySnapshot(next);
	stack.lastSource = null;
	return cloneEditorHistorySnapshot(next);
}
