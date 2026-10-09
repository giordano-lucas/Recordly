import { packClipSequence } from "./clipSequence";
import { planClipSplit } from "./clipSplit";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	getClipSourceStartMs,
	sortClipRegions,
	type ZoomRegion,
} from "./types";

export type TimelineClipboardEntry =
	| { kind: "clip"; region: ClipRegion }
	| { kind: "zoom"; region: ZoomRegion }
	| { kind: "annotation"; region: AnnotationRegion }
	| { kind: "audio"; region: AudioRegion };

export type TimelineClipboardKind = TimelineClipboardEntry["kind"];

/**
 * Process-wide so a copy survives switching projects. Entries are deep clones,
 * so later edits to the source region never change what gets pasted.
 */
let clipboard: TimelineClipboardEntry | null = null;

export function writeTimelineClipboard(entry: TimelineClipboardEntry): void {
	clipboard = globalThis.structuredClone(entry);
}

export function readTimelineClipboard(): TimelineClipboardEntry | null {
	return clipboard ? globalThis.structuredClone(clipboard) : null;
}

export interface ClipInsertResult {
	/** Clips after any split at the insertion point, at unchanged timeline positions. */
	before: ClipRegion[];
	/** The packed sequence with the new clip in place. */
	after: ClipRegion[];
	insertedId: string;
}

/**
 * Inserts a copy of `clip` into the primary storyline at `atMs`, splitting the
 * clip under that point first. Everything after the insertion ripples right.
 */
export function insertClipCopy(
	clips: ClipRegion[],
	clip: ClipRegion,
	atMs: number,
	createId: () => string,
): ClipInsertResult {
	const insertAtMs = Math.round(Math.max(0, atMs));
	const split = planClipSplit({ clipRegions: clips, splitMs: insertAtMs, createId });
	const before = sortClipRegions(
		split
			? clips.flatMap((candidate) =>
					candidate.id === split.targetId ? [split.left, split.right] : [candidate],
				)
			: clips,
	);
	const durationMs = clip.endMs - clip.startMs;
	const inserted: ClipRegion = {
		...clip,
		id: createId(),
		sourceStartMs: getClipSourceStartMs(clip),
		startMs: insertAtMs,
		endMs: insertAtMs + durationMs,
	};
	const index = before.filter((candidate) => candidate.startMs < insertAtMs).length;
	const ordered = [...before];
	ordered.splice(index, 0, inserted);
	return { before, after: packClipSequence(ordered), insertedId: inserted.id };
}

type Span = { startMs: number; endMs: number };

function overlaps(left: Span, right: Span): boolean {
	return left.startMs < right.endMs && right.startMs < left.endMs;
}

/**
 * Where a pasted zoom, annotation or audio region lands: at `atMs`, kept on the
 * timeline, on its own track when that is free, otherwise the first free track.
 * Zooms share one lane and cannot overlap, so a zoom with no room returns null.
 */
export function placeRegionCopy(
	existing: (Span & { trackIndex?: number })[],
	source: Span & { trackIndex?: number },
	atMs: number,
	totalMs: number,
	options: { tracks: boolean },
): { startMs: number; endMs: number; trackIndex?: number } | null {
	const durationMs = Math.max(1, Math.min(source.endMs - source.startMs, totalMs));
	const startMs = Math.round(Math.max(0, Math.min(atMs, totalMs - durationMs)));
	const span = { startMs, endMs: startMs + durationMs };
	if (!options.tracks) {
		return existing.some((region) => overlaps(region, span)) ? null : span;
	}
	const isFree = (trackIndex: number) =>
		!existing.some(
			(region) => (region.trackIndex ?? 0) === trackIndex && overlaps(region, span),
		);
	const preferred = source.trackIndex ?? 0;
	if (isFree(preferred)) return { ...span, trackIndex: preferred };
	for (let trackIndex = 0; ; trackIndex += 1) {
		if (isFree(trackIndex)) return { ...span, trackIndex };
	}
}
