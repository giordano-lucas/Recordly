import { describe, expect, it } from "vitest";
import { rippleRegions } from "./clipSequence";
import {
	insertClipCopy,
	placeRegionCopy,
	readTimelineClipboard,
	writeTimelineClipboard,
} from "./timelineClipboard";
import type { ClipRegion, ZoomRegion } from "./types";

const ids = () => {
	let next = 100;
	return () => `clip-${next++}`;
};

describe("insertClipCopy", () => {
	const clips: ClipRegion[] = [
		{ id: "a", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
		{ id: "b", startMs: 2000, endMs: 5000, sourceStartMs: 4000, speed: 1 },
	];

	it("splits the clip under the playhead and ripples the rest right", () => {
		const { after, insertedId } = insertClipCopy(clips, clips[1], 1000, ids());

		expect(
			after.map(({ startMs, endMs, sourceStartMs }) => [startMs, endMs, sourceStartMs]),
		).toEqual([
			[0, 1000, 0],
			[1000, 4000, 4000],
			[4000, 5000, 1000],
			[5000, 8000, 4000],
		]);
		expect(after[1].id).toBe(insertedId);
	});

	it("inserts at a clip boundary without splitting", () => {
		const { before, after } = insertClipCopy(clips, clips[0], 2000, ids());
		expect(before.map(({ id }) => id)).toEqual(["a", "b"]);
		expect(after.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[0, 2000],
			[2000, 4000],
			[4000, 7000],
		]);
	});

	it("appends past the end of the storyline", () => {
		const { after } = insertClipCopy(clips, clips[0], 9000, ids());
		expect(after.at(-1)).toMatchObject({ startMs: 5000, endMs: 7000, sourceStartMs: 0 });
	});

	it("moves zooms with the footage they cover", () => {
		const zoom = { id: "z", startMs: 3000, endMs: 3500 } as ZoomRegion;
		const { before, after } = insertClipCopy(clips, clips[0], 1000, ids());
		expect(rippleRegions([zoom], before, after)).toMatchObject([
			{ startMs: 5000, endMs: 5500 },
		]);
	});
});

describe("placeRegionCopy", () => {
	it("refuses a zoom that would overlap another zoom", () => {
		const existing = [{ startMs: 1000, endMs: 2000 }];
		expect(
			placeRegionCopy(existing, { startMs: 0, endMs: 500 }, 1500, 10000, { tracks: false }),
		).toBeNull();
		expect(
			placeRegionCopy(existing, { startMs: 0, endMs: 500 }, 2000, 10000, { tracks: false }),
		).toEqual({ startMs: 2000, endMs: 2500 });
	});

	it("moves a tracked region to the first free track", () => {
		const existing = [
			{ startMs: 0, endMs: 3000, trackIndex: 0 },
			{ startMs: 0, endMs: 3000, trackIndex: 1 },
		];
		expect(
			placeRegionCopy(existing, { startMs: 0, endMs: 1000, trackIndex: 0 }, 500, 10000, {
				tracks: true,
			}),
		).toEqual({ startMs: 500, endMs: 1500, trackIndex: 2 });
	});

	it("keeps the copy inside the timeline", () => {
		expect(
			placeRegionCopy([], { startMs: 0, endMs: 1000 }, 9800, 10000, { tracks: false }),
		).toEqual({ startMs: 9000, endMs: 10000 });
	});
});

describe("timeline clipboard", () => {
	it("stores an independent copy", () => {
		const region = { id: "z", startMs: 0, endMs: 1, depth: 2, focus: { cx: 0.5, cy: 0.5 } };
		writeTimelineClipboard({ kind: "zoom", region: region as ZoomRegion });
		region.focus.cx = 0.9;
		const entry = readTimelineClipboard();
		expect(entry?.kind === "zoom" && entry.region.focus.cx).toBe(0.5);
	});
});
