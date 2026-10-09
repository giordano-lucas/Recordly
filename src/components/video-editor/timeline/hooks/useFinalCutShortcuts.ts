import type { Range } from "dnd-timeline";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { usePlayheadClock } from "../../state/playheadClock";
import {
	type AnnotationRegion,
	type ClipRegion,
	findClipAtTimelineTime,
	type ZoomRegion,
} from "../../types";
import { createInitialRange } from "../core/time";
import type { ClipSequenceSpan } from "../core/timelineTypes";

/** Screen recordings target 60fps; arrow keys step one such frame. */
export const FRAME_STEP_MS = 1000 / 60;
export const LARGE_FRAME_STEP = 10;
const EDIT_POINT_EPSILON_MS = 1;
const TIMELINE_ZOOM_FACTOR = 1.5;

export type FinalCutCommand =
	| { type: "blade" }
	| { type: "step"; frames: number }
	| { type: "edit-point"; direction: -1 | 1 }
	| { type: "go-to"; edge: "start" | "end" }
	| { type: "trim-to-playhead"; edge: "start" | "end" }
	| { type: "zoom-timeline"; zoom: "in" | "out" | "fit" }
	| { type: "deselect" }
	| { type: "mark"; edge: "in" | "out" }
	| { type: "clear-range" };

/** Final Cut style range: an in point alone runs to the end, an out point alone from the start. */
export interface RangeSelection {
	inMs: number | null;
	outMs: number | null;
}

export function resolveRangeSelection(
	selection: RangeSelection | null,
	totalMs: number,
): { startMs: number; endMs: number } | null {
	if (!selection || (selection.inMs === null && selection.outMs === null)) return null;
	const startMs = Math.max(0, selection.inMs ?? 0);
	const endMs = Math.min(totalMs, selection.outMs ?? totalMs);
	return endMs > startMs ? { startMs, endMs } : null;
}

/** Marking one edge past the other drops the other edge, as in Final Cut Pro. */
export function markRangeEdge(
	selection: RangeSelection | null,
	edge: "in" | "out",
	timeMs: number,
): RangeSelection {
	if (edge === "in") {
		const outMs = selection?.outMs ?? null;
		return { inMs: timeMs, outMs: outMs !== null && outMs > timeMs ? outMs : null };
	}
	const inMs = selection?.inMs ?? null;
	return { inMs: inMs !== null && inMs < timeMs ? inMs : null, outMs: timeMs };
}

/**
 * Maps a keydown to a Final Cut Pro default binding. Letters match the typed
 * character (layout aware); bracket keys match the physical key because Option
 * turns "[" into a quote character on macOS layouts.
 */
export function resolveFinalCutCommand(
	event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
	isMac: boolean,
): FinalCutCommand | null {
	const primary = isMac ? event.metaKey : event.ctrlKey;
	const otherPrimary = isMac ? event.ctrlKey : event.metaKey;
	if (otherPrimary) return null;
	const key = event.key.toLowerCase();
	const plain = !primary && !event.altKey;

	if (primary && !event.altKey && !event.shiftKey && key === "b") return { type: "blade" };
	if (primary && !event.altKey && (key === "=" || key === "+" || event.code === "Equal")) {
		return { type: "zoom-timeline", zoom: "in" };
	}
	if (primary && !event.altKey && !event.shiftKey && (key === "-" || event.code === "Minus")) {
		return { type: "zoom-timeline", zoom: "out" };
	}
	if (primary && event.shiftKey && !event.altKey && key === "a") return { type: "deselect" };
	// Option turns X into "≈" on macOS layouts, so match the physical key.
	if (event.altKey && !primary && !event.shiftKey && event.code === "KeyX") {
		return { type: "clear-range" };
	}
	if (
		event.altKey &&
		!primary &&
		!event.shiftKey &&
		(event.code === "BracketLeft" || event.code === "BracketRight")
	) {
		return {
			type: "trim-to-playhead",
			edge: event.code === "BracketLeft" ? "start" : "end",
		};
	}
	if (!plain) return null;

	switch (event.key) {
		case "ArrowLeft":
			return { type: "step", frames: event.shiftKey ? -LARGE_FRAME_STEP : -1 };
		case "ArrowRight":
			return { type: "step", frames: event.shiftKey ? LARGE_FRAME_STEP : 1 };
		case "ArrowUp":
			return event.shiftKey ? null : { type: "edit-point", direction: -1 };
		case "ArrowDown":
			return event.shiftKey ? null : { type: "edit-point", direction: 1 };
		case "Home":
			return event.shiftKey ? null : { type: "go-to", edge: "start" };
		case "End":
			return event.shiftKey ? null : { type: "go-to", edge: "end" };
		case "Escape":
			return event.shiftKey ? null : { type: "deselect" };
	}
	if (event.shiftKey && key === "z") return { type: "zoom-timeline", zoom: "fit" };
	if (!event.shiftKey && (key === "i" || key === "o")) {
		return { type: "mark", edge: key === "i" ? "in" : "out" };
	}
	return null;
}

/**
 * Steps along the frame grid. The playhead is read in whole milliseconds, so
 * adding a frame to it directly would drift a third of a millisecond per step.
 */
export function stepFrames(timeMs: number, frames: number): number {
	return (Math.round(timeMs / FRAME_STEP_MS) + frames) * FRAME_STEP_MS;
}

/** Sorted, de-duplicated boundaries of clips, zooms and annotations. */
export function collectEditPoints(
	clips: ClipRegion[],
	zooms: ZoomRegion[],
	annotations: AnnotationRegion[],
	totalMs: number,
): number[] {
	const points = new Set<number>([0, totalMs]);
	for (const region of [...clips, ...zooms, ...annotations]) {
		points.add(Math.round(region.startMs));
		points.add(Math.round(region.endMs));
	}
	return [...points]
		.filter((point) => point >= 0 && point <= totalMs)
		.sort((left, right) => left - right);
}

export function findAdjacentEditPoint(
	points: number[],
	timeMs: number,
	direction: -1 | 1,
): number | null {
	if (direction < 0) {
		for (let index = points.length - 1; index >= 0; index -= 1) {
			if (points[index] < timeMs - EDIT_POINT_EPSILON_MS) return points[index];
		}
		return null;
	}
	return points.find((point) => point > timeMs + EDIT_POINT_EPSILON_MS) ?? null;
}

/** New visible range after zooming around an anchor (the playhead). */
export function zoomTimelineRange(
	range: Range,
	zoom: "in" | "out" | "fit",
	anchorMs: number,
	totalMs: number,
	minVisibleRangeMs: number,
): Range {
	if (zoom === "fit" || totalMs <= 0) return createInitialRange(totalMs);
	const span = Math.max(1, range.end - range.start);
	const nextSpan = Math.max(
		Math.min(minVisibleRangeMs, totalMs),
		Math.min(
			totalMs,
			zoom === "in" ? span / TIMELINE_ZOOM_FACTOR : span * TIMELINE_ZOOM_FACTOR,
		),
	);
	// Keep the anchor at the same place on screen when it is visible.
	const anchorRatio =
		anchorMs >= range.start && anchorMs <= range.end ? (anchorMs - range.start) / span : 0.5;
	const start = Math.max(0, Math.min(totalMs - nextSpan, anchorMs - nextSpan * anchorRatio));
	return { start, end: start + nextSpan };
}

export function isShortcutBlockedTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement &&
			(target.isContentEditable ||
				Boolean(
					target.closest(
						'[data-recording-library], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="slider"], [role="spinbutton"]',
					),
				)))
	);
}

interface UseFinalCutShortcutsParams {
	isMac: boolean;
	enabled: boolean;
	totalMs: number;
	currentTimeMs: number;
	minVisibleRangeMs: number;
	range: Range;
	setRange: Dispatch<SetStateAction<Range>>;
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	selectedClipId?: string | null;
	minClipDurationMs: number;
	onSeek?: (timeSeconds: number) => void;
	onBlade: () => void;
	onClipSpanChange?: (id: string, span: ClipSequenceSpan) => void;
	onDeselectAll: () => void;
	rangeSelection: RangeSelection | null;
	setRangeSelection: Dispatch<SetStateAction<RangeSelection | null>>;
	onRemoveRange?: (inMs: number, outMs: number) => boolean;
}

/**
 * Final Cut Pro default keyboard editing. These work anywhere in the editor,
 * not only while the timeline has focus, except in text fields, sliders and
 * dialogs.
 */
export function useFinalCutShortcuts(params: UseFinalCutShortcutsParams) {
	const playheadClock = usePlayheadClock();
	// The listener is registered once and always reads the latest params.
	const paramsRef = useRef(params);
	paramsRef.current = params;

	useEffect(() => {
		const readPlayheadMs = () =>
			playheadClock
				? Math.round(playheadClock.get() * 1000)
				: paramsRef.current.currentTimeMs;

		const handleKeyDown = (event: KeyboardEvent) => {
			const p = paramsRef.current;
			if (!p.enabled || event.defaultPrevented || event.isComposing) return;
			if (isShortcutBlockedTarget(event.target)) return;
			const command = resolveFinalCutCommand(event, p.isMac);
			if (!command || p.totalMs <= 0) return;

			const nowMs = readPlayheadMs();
			const seekMs = (timeMs: number) =>
				p.onSeek?.(Math.max(0, Math.min(p.totalMs, timeMs)) / 1000);

			switch (command.type) {
				case "blade":
					p.onBlade();
					break;
				case "step":
					seekMs(stepFrames(nowMs, command.frames));
					break;
				case "edit-point": {
					const points = collectEditPoints(
						p.clipRegions,
						p.zoomRegions,
						p.annotationRegions,
						p.totalMs,
					);
					const target = findAdjacentEditPoint(points, nowMs, command.direction);
					if (target === null) return;
					seekMs(target);
					break;
				}
				case "go-to":
					seekMs(command.edge === "start" ? 0 : p.totalMs);
					break;
				case "trim-to-playhead": {
					const selected = p.selectedClipId
						? p.clipRegions.find((clip) => clip.id === p.selectedClipId)
						: undefined;
					const clip =
						selected && nowMs > selected.startMs && nowMs < selected.endMs
							? selected
							: findClipAtTimelineTime(nowMs, p.clipRegions);
					if (!clip || !p.onClipSpanChange) return;
					const span =
						command.edge === "start"
							? { start: nowMs, end: clip.endMs }
							: { start: clip.startMs, end: nowMs };
					if (span.end - span.start < p.minClipDurationMs) return;
					p.onClipSpanChange(clip.id, span);
					// The magnetic timeline closes the gap; keep the playhead on the edit.
					if (command.edge === "start") seekMs(clip.startMs);
					break;
				}
				case "zoom-timeline":
					p.setRange(
						zoomTimelineRange(
							p.range,
							command.zoom,
							nowMs,
							p.totalMs,
							p.minVisibleRangeMs,
						),
					);
					break;
				case "deselect":
					p.onDeselectAll();
					break;
				case "mark":
					p.setRangeSelection((current) => markRangeEdge(current, command.edge, nowMs));
					break;
				case "clear-range":
					if (!p.rangeSelection) return;
					p.setRangeSelection(null);
					break;
			}
			event.preventDefault();
		};

		// Capture phase: with a range marked, Delete removes the range instead of
		// the selected item (the item handler runs on bubble and skips handled keys).
		const handleRangeDelete = (event: KeyboardEvent) => {
			const p = paramsRef.current;
			if (!p.enabled || event.defaultPrevented || event.isComposing) return;
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (event.altKey || event.shiftKey || event.ctrlKey) return;
			if (isShortcutBlockedTarget(event.target)) return;
			const range = resolveRangeSelection(p.rangeSelection, p.totalMs);
			if (!range || !p.onRemoveRange) return;
			event.preventDefault();
			if (!p.onRemoveRange(range.startMs, range.endMs)) return;
			p.setRangeSelection(null);
			p.onSeek?.(range.startMs / 1000);
		};

		window.addEventListener("keydown", handleRangeDelete, { capture: true });
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleRangeDelete, { capture: true });
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [playheadClock]);
}
