import { type MutableRefObject, useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { rippleRegionAnchors, rippleRegions } from "../clipSequence";
import type { PlayheadClock } from "../state/playheadClock";
import type { useTimelineState } from "../state/useTimelineState";
import { isShortcutBlockedTarget } from "../timeline/hooks/useFinalCutShortcuts";
import {
	insertClipCopy,
	placeRegionCopy,
	readTimelineClipboard,
	type TimelineClipboardEntry,
	writeTimelineClipboard,
} from "../timelineClipboard";

export type ClipboardAction = "copy" | "cut" | "paste" | "duplicate";

interface Input {
	isMac: boolean;
	timeline: ReturnType<typeof useTimelineState>;
	playheadClock?: PlayheadClock;
	currentTime: number;
	timelineDurationSeconds: number;
	nextClipIdRef: MutableRefObject<number>;
	nextZoomIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	selectClip: (id: string | null) => void;
	selectZoom: (id: string | null) => void;
	selectAnnotation: (id: string | null) => void;
	selectAudio: (id: string | null) => void;
	deleteClip: (id: string) => void;
	deleteZoom: (id: string) => void;
	deleteAnnotation: (id: string) => void;
	deleteAudio: (id: string) => void;
}

/** A menu role and the keydown for one shortcut can both fire; handle it once. */
const DUPLICATE_EVENT_WINDOW_MS = 150;

/**
 * Copy, cut, paste and duplicate for timeline items (⌘C, ⌘X, ⌘V, ⌘D).
 * Clips paste into the primary storyline at the playhead and ripple what
 * follows; zooms, annotations and audio paste at the playhead on a free lane.
 * Duplicate places the copy right after the original.
 */
export function useTimelineClipboard(input: Input) {
	const inputRef = useRef(input);
	inputRef.current = input;

	useEffect(() => {
		const selectedEntry = (): TimelineClipboardEntry | null => {
			const { timeline: t } = inputRef.current;
			const find = <T extends { id: string }>(regions: T[], id: string | null) =>
				id ? regions.find((region) => region.id === id) : undefined;
			const clip = find(t.clipRegions, t.selectedClipId);
			if (clip) return { kind: "clip", region: clip };
			const zoom = find(t.zoomRegions, t.selectedZoomId);
			if (zoom) return { kind: "zoom", region: zoom };
			const annotation = find(t.annotationRegions, t.selectedAnnotationId);
			if (annotation) return { kind: "annotation", region: annotation };
			const audio = find(t.audioRegions, t.selectedAudioId);
			if (audio) return { kind: "audio", region: audio };
			return null;
		};

		const deleteEntry = (entry: TimelineClipboardEntry) => {
			const i = inputRef.current;
			if (entry.kind === "clip") i.deleteClip(entry.region.id);
			else if (entry.kind === "zoom") i.deleteZoom(entry.region.id);
			else if (entry.kind === "annotation") i.deleteAnnotation(entry.region.id);
			else i.deleteAudio(entry.region.id);
		};

		const pasteEntry = (entry: TimelineClipboardEntry, atMs: number) => {
			const i = inputRef.current;
			const t = i.timeline;
			const totalMs = Math.round(i.timelineDurationSeconds * 1000);

			if (entry.kind === "clip") {
				const { before, after, insertedId } = insertClipCopy(
					t.clipRegions,
					entry.region,
					atMs,
					() => `clip-${i.nextClipIdRef.current++}`,
				);
				t.setClipRegions(after);
				t.setZoomRegions((current) => rippleRegions(current, before, after));
				t.setAnnotationRegions((current) => rippleRegions(current, before, after));
				t.setAudioRegions((current) => rippleRegionAnchors(current, before, after));
				i.selectClip(insertedId);
				return;
			}

			const existing =
				entry.kind === "zoom"
					? t.zoomRegions
					: entry.kind === "annotation"
						? t.annotationRegions
						: t.audioRegions;
			const placement = placeRegionCopy(existing, entry.region, atMs, totalMs, {
				tracks: entry.kind !== "zoom",
			});
			if (!placement) {
				toast.info("No room for the zoom here: zooms cannot overlap");
				return;
			}

			if (entry.kind === "zoom") {
				const id = `zoom-${i.nextZoomIdRef.current++}`;
				t.setZoomRegions((current) => [
					...current,
					{ ...entry.region, id, startMs: placement.startMs, endMs: placement.endMs },
				]);
				i.selectZoom(id);
			} else if (entry.kind === "annotation") {
				const id = `annotation-${i.nextAnnotationIdRef.current++}`;
				t.setAnnotationRegions((current) => [
					...current,
					{
						...entry.region,
						...placement,
						id,
						zIndex: i.nextAnnotationZIndexRef.current++,
					},
				]);
				i.selectAnnotation(id);
			} else {
				const id = `audio-${i.nextAudioIdRef.current++}`;
				t.setAudioRegions((current) => [...current, { ...entry.region, ...placement, id }]);
				i.selectAudio(id);
			}
		};

		const run = (action: ClipboardAction): boolean => {
			const i = inputRef.current;
			if (action === "paste") {
				const entry = readTimelineClipboard();
				if (!entry) return false;
				const playheadMs = i.playheadClock
					? i.playheadClock.get() * 1000
					: i.currentTime * 1000;
				pasteEntry(entry, playheadMs);
				return true;
			}
			const entry = selectedEntry();
			if (!entry) return false;
			if (action === "duplicate") {
				pasteEntry(globalThis.structuredClone(entry), entry.region.endMs);
				return true;
			}
			writeTimelineClipboard(entry);
			if (action === "cut") deleteEntry(entry);
			return true;
		};

		const lastHandled = new Map<ClipboardAction, number>();
		const handle = (action: ClipboardAction, event: Event) => {
			if (event.defaultPrevented || isShortcutBlockedTarget(event.target)) return;
			// Leave ordinary text copying alone.
			if (action !== "paste" && !window.getSelection()?.isCollapsed) return;
			const now = performance.now();
			if (
				now - (lastHandled.get(action) ?? Number.NEGATIVE_INFINITY) <
				DUPLICATE_EVENT_WINDOW_MS
			) {
				event.preventDefault();
				return;
			}
			if (!run(action)) return;
			lastHandled.set(action, now);
			event.preventDefault();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			const { isMac } = inputRef.current;
			const primary = isMac ? event.metaKey : event.ctrlKey;
			const otherPrimary = isMac ? event.ctrlKey : event.metaKey;
			if (!primary || otherPrimary || event.altKey || event.shiftKey || event.repeat) return;
			const key = event.key.toLowerCase();
			const action: ClipboardAction | null =
				key === "c"
					? "copy"
					: key === "x"
						? "cut"
						: key === "v"
							? "paste"
							: key === "d"
								? "duplicate"
								: null;
			if (action) handle(action, event);
		};
		// The Edit menu's copy/cut/paste roles fire these instead of a keydown.
		const handleCopy = (event: ClipboardEvent) => handle("copy", event);
		const handleCut = (event: ClipboardEvent) => handle("cut", event);
		const handlePaste = (event: ClipboardEvent) => handle("paste", event);

		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("copy", handleCopy);
		document.addEventListener("cut", handleCut);
		document.addEventListener("paste", handlePaste);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("copy", handleCopy);
			document.removeEventListener("cut", handleCut);
			document.removeEventListener("paste", handlePaste);
		};
	}, []);
}
