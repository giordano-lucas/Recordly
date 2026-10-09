import { describe, expect, it } from "vitest";
import type { ClipRegion, ZoomRegion } from "../../types";
import {
	collectEditPoints,
	findAdjacentEditPoint,
	resolveFinalCutCommand,
	stepFrames,
	zoomTimelineRange,
} from "./useFinalCutShortcuts";

const key = (
	keyValue: string,
	modifiers: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {},
	code = "",
) => ({
	key: keyValue,
	code,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...modifiers,
});

describe("resolveFinalCutCommand", () => {
	it("maps Final Cut Pro defaults on macOS", () => {
		expect(resolveFinalCutCommand(key("b", { metaKey: true }), true)).toEqual({
			type: "blade",
		});
		expect(resolveFinalCutCommand(key("ArrowLeft"), true)).toEqual({
			type: "step",
			frames: -1,
		});
		expect(resolveFinalCutCommand(key("ArrowRight", { shiftKey: true }), true)).toEqual({
			type: "step",
			frames: 10,
		});
		expect(resolveFinalCutCommand(key("ArrowDown"), true)).toEqual({
			type: "edit-point",
			direction: 1,
		});
		expect(resolveFinalCutCommand(key("Z", { shiftKey: true }), true)).toEqual({
			type: "zoom-timeline",
			zoom: "fit",
		});
		expect(resolveFinalCutCommand(key("Escape"), true)).toEqual({ type: "deselect" });
	});

	it("matches Option-bracket trims by physical key", () => {
		// Option+[ types a quote character on US Mac layouts.
		expect(resolveFinalCutCommand(key("“", { altKey: true }, "BracketLeft"), true)).toEqual({
			type: "trim-to-playhead",
			edge: "start",
		});
		expect(resolveFinalCutCommand(key("‘", { altKey: true }, "BracketRight"), true)).toEqual({
			type: "trim-to-playhead",
			edge: "end",
		});
	});

	it("uses Ctrl as the primary modifier off macOS", () => {
		expect(resolveFinalCutCommand(key("b", { ctrlKey: true }), false)).toEqual({
			type: "blade",
		});
		expect(resolveFinalCutCommand(key("b", { metaKey: true }), false)).toBeNull();
		expect(resolveFinalCutCommand(key("b", { ctrlKey: true }), true)).toBeNull();
	});

	it("leaves plain letters to the configurable shortcuts", () => {
		expect(resolveFinalCutCommand(key("z"), true)).toBeNull();
		expect(resolveFinalCutCommand(key("b"), true)).toBeNull();
	});
});

describe("edit points", () => {
	const clips = [
		{ id: "a", startMs: 0, endMs: 1000 },
		{ id: "b", startMs: 1000, endMs: 2500 },
	] as ClipRegion[];
	const zooms = [{ id: "z", startMs: 1800, endMs: 2200 }] as ZoomRegion[];
	const points = collectEditPoints(clips, zooms, [], 2500);

	it("collects sorted unique boundaries", () => {
		expect(points).toEqual([0, 1000, 1800, 2200, 2500]);
	});

	it("skips the edit point under the playhead", () => {
		expect(findAdjacentEditPoint(points, 1000, 1)).toBe(1800);
		expect(findAdjacentEditPoint(points, 1000, -1)).toBe(0);
		expect(findAdjacentEditPoint(points, 2500, 1)).toBeNull();
	});
});

describe("zoomTimelineRange", () => {
	it("zooms around the playhead and clamps to the timeline", () => {
		const range = zoomTimelineRange({ start: 0, end: 9000 }, "in", 4500, 9000, 500);
		expect(range.end - range.start).toBeCloseTo(6000);
		expect((range.start + range.end) / 2).toBeCloseTo(4500);

		const out = zoomTimelineRange({ start: 0, end: 6000 }, "out", 0, 9000, 500);
		expect(out).toEqual({ start: 0, end: 9000 });
	});

	it("never zooms past the minimum visible span", () => {
		const range = zoomTimelineRange({ start: 0, end: 600 }, "in", 300, 9000, 500);
		expect(range.end - range.start).toBe(500);
	});

	it("fits the whole timeline", () => {
		expect(zoomTimelineRange({ start: 10, end: 20 }, "fit", 15, 9000, 500)).toEqual({
			start: 0,
			end: 9000,
		});
	});
});

describe("stepFrames", () => {
	it("does not drift when steps start from a rounded playhead", () => {
		let timeMs = 0;
		for (let step = 0; step < 18; step += 1) timeMs = Math.round(stepFrames(timeMs, 10));
		expect(timeMs).toBe(3000);
	});
});
