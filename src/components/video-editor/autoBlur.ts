import type { SensitiveSpan } from "@/lib/sensitiveText";
import { placeRegionCopy } from "./timelineClipboard";
import {
	type AnnotationRegion,
	type ClipRegion,
	type CropRegion,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_INTENSITY,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "./types";

/** Marks blurs created by secret detection, so a re-scan replaces them. */
export const AUTO_BLUR_CONTENT = "auto-redact";

export function isAutoBlur(region: AnnotationRegion): boolean {
	return region.type === "blur" && region.content === AUTO_BLUR_CONTENT;
}

/**
 * Timeline spans showing the source span [startMs, endMs). A cut can split it
 * and a reorder can move its pieces, so each clip is intersected separately.
 */
export function projectSourceSpanToTimeline(
	startMs: number,
	endMs: number,
	clips: ClipRegion[],
): { startMs: number; endMs: number }[] {
	if (clips.length === 0) return endMs > startMs ? [{ startMs, endMs }] : [];
	return sortClipRegions(clips).flatMap((clip) => {
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = getClipSourceEndMs(clip);
		const from = Math.max(startMs, sourceStart);
		const to = Math.min(endMs, sourceEnd);
		if (to <= from) return [];
		const speed = clip.speed > 0 ? clip.speed : 1;
		return [
			{
				startMs: Math.round(clip.startMs + (from - sourceStart) / speed),
				endMs: Math.round(clip.startMs + (to - sourceStart) / speed),
			},
		];
	});
}

/** Annotation position and size are percentages of the cropped video. */
export function sourceBoxToCropPercent(
	box: SensitiveSpan["box"],
	crop: CropRegion,
): { position: { x: number; y: number }; size: { width: number; height: number } } | null {
	const [x, y, width, height] = box;
	const left = Math.max(x, crop.x);
	const top = Math.max(y, crop.y);
	const right = Math.min(x + width, crop.x + crop.width);
	const bottom = Math.min(y + height, crop.y + crop.height);
	if (right <= left || bottom <= top) return null;
	return {
		position: {
			x: ((left - crop.x) / crop.width) * 100,
			y: ((top - crop.y) / crop.height) * 100,
		},
		size: {
			width: ((right - left) / crop.width) * 100,
			height: ((bottom - top) / crop.height) * 100,
		},
	};
}

export function buildAutoBlurAnnotations(params: {
	spans: SensitiveSpan[];
	clips: ClipRegion[];
	crop: CropRegion;
	existing: AnnotationRegion[];
	createId: () => string;
	nextZIndex: () => number;
}): AnnotationRegion[] {
	const placed: AnnotationRegion[] = [];
	for (const span of params.spans) {
		const geometry = sourceBoxToCropPercent(span.box, params.crop);
		if (!geometry) continue;
		for (const piece of projectSourceSpanToTimeline(span.startMs, span.endMs, params.clips)) {
			const placement = placeRegionCopy(
				[...params.existing, ...placed],
				{ ...piece, trackIndex: 0 },
				piece.startMs,
				Number.MAX_SAFE_INTEGER,
				{ tracks: true },
			);
			if (!placement) continue;
			placed.push({
				id: params.createId(),
				startMs: placement.startMs,
				endMs: placement.endMs,
				trackIndex: placement.trackIndex,
				type: "blur",
				content: AUTO_BLUR_CONTENT,
				blurIntensity: DEFAULT_BLUR_INTENSITY,
				position: geometry.position,
				size: geometry.size,
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex: params.nextZIndex(),
			});
		}
	}
	return placed;
}
