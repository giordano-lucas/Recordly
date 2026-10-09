import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayheadClock } from "./playheadClock";

describe("createPlayheadClock", () => {
	let nowMs = 0;
	const now = () => nowMs;

	beforeEach(() => {
		vi.useFakeTimers();
		nowMs = 0;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const advance = (ms: number) => {
		nowMs += ms;
		vi.advanceTimersByTime(ms);
	};

	it("publishes every live update but commits a burst once per interval", () => {
		const clock = createPlayheadClock(100, now);
		const live = vi.fn();
		const committed = vi.fn();
		clock.subscribe(live);
		clock.subscribeCommitted(committed);

		// One second of 60fps playback.
		for (let frame = 1; frame <= 60; frame++) {
			clock.set(frame / 60);
			advance(1000 / 60);
		}
		advance(100);

		expect(live).toHaveBeenCalledTimes(60);
		expect(committed.mock.calls.length).toBeLessThanOrEqual(12);
		expect(clock.getCommitted()).toBe(1);
	});

	it("commits a lone seek immediately", () => {
		const clock = createPlayheadClock(100, now);
		const committed = vi.fn();
		clock.subscribeCommitted(committed);

		clock.set(4.2);

		expect(committed).toHaveBeenCalledTimes(1);
		expect(clock.getCommitted()).toBe(4.2);
	});

	it("always lands the committed time on the last live value", () => {
		const clock = createPlayheadClock(100, now);
		clock.set(1);
		advance(10);
		clock.set(2);
		advance(10);
		clock.set(3);
		expect(clock.getCommitted()).toBe(1);

		advance(100);
		expect(clock.getCommitted()).toBe(3);
		expect(clock.get()).toBe(3);
	});

	it("ignores no-op updates", () => {
		const clock = createPlayheadClock(100, now);
		const live = vi.fn();
		clock.subscribe(live);
		clock.set(0);
		expect(live).not.toHaveBeenCalled();
	});

	it("dispose cancels a pending trailing commit", () => {
		const clock = createPlayheadClock(100, now);
		clock.set(1);
		clock.set(2);
		clock.dispose();
		advance(200);
		expect(clock.getCommitted()).toBe(1);
	});
});
