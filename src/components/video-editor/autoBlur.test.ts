import { describe, expect, it } from "vitest";
import {
	AUTO_BLUR_CONTENT,
	buildAutoBlurAnnotations,
	projectSourceSpanToTimeline,
	sourceBoxToCropPercent,
} from "./autoBlur";
import type { ClipRegion } from "./types";

describe("projectSourceSpanToTimeline", () => {
	it("follows cuts, reorders and speed", () => {
		const clips: ClipRegion[] = [
			{ id: "late", startMs: 0, endMs: 1000, sourceStartMs: 6000, speed: 2 },
			{ id: "early", startMs: 1000, endMs: 4000, sourceStartMs: 0, speed: 1 },
		];
		// Source 2000-7000 covers the end of "early" and the start of "late".
		expect(projectSourceSpanToTimeline(2000, 7000, clips)).toEqual([
			{ startMs: 0, endMs: 500 },
			{ startMs: 3000, endMs: 4000 },
		]);
	});

	it("drops footage that was cut out", () => {
		const clips: ClipRegion[] = [{ id: "a", startMs: 0, endMs: 1000, speed: 1 }];
		expect(projectSourceSpanToTimeline(2000, 3000, clips)).toEqual([]);
	});
});

describe("sourceBoxToCropPercent", () => {
	it("maps into the cropped frame and clips to it", () => {
		const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
		expect(sourceBoxToCropPercent([0.6, 0.1, 0.1, 0.05], crop)).toEqual({
			position: { x: expect.closeTo(20), y: expect.closeTo(10) },
			size: { width: expect.closeTo(20), height: expect.closeTo(5) },
		});
		expect(sourceBoxToCropPercent([0.1, 0.1, 0.1, 0.05], crop)).toBeNull();
	});
});

describe("buildAutoBlurAnnotations", () => {
	it("creates blur annotations on free tracks", () => {
		let id = 0;
		let z = 10;
		const annotations = buildAutoBlurAnnotations({
			spans: [
				{ startMs: 0, endMs: 4000, box: [0.1, 0.1, 0.2, 0.05], reason: "known-format" },
				{ startMs: 0, endMs: 4000, box: [0.1, 0.3, 0.2, 0.05], reason: "labelled" },
			],
			clips: [],
			crop: { x: 0, y: 0, width: 1, height: 1 },
			existing: [],
			createId: () => `annotation-${id++}`,
			nextZIndex: () => z++,
		});
		expect(
			annotations.map((region) => [region.type, region.content, region.trackIndex]),
		).toEqual([
			["blur", AUTO_BLUR_CONTENT, 0],
			["blur", AUTO_BLUR_CONTENT, 1],
		]);
	});
});
