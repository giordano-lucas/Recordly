import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * Timeline playhead time (seconds) kept outside React state.
 *
 * Playback publishes every animation frame. Only leaf components that draw the
 * playhead subscribe to the live value; the rest of the editor reads a
 * committed value that is throttled, so playback no longer re-renders the
 * whole editor tree at display rate.
 */
export interface PlayheadClock {
	get: () => number;
	set: (timeSeconds: number) => void;
	subscribe: (listener: () => void) => () => void;
	getCommitted: () => number;
	subscribeCommitted: (listener: () => void) => () => void;
	dispose: () => void;
}

export const PLAYHEAD_COMMIT_INTERVAL_MS = 100;

export function createPlayheadClock(
	commitIntervalMs = PLAYHEAD_COMMIT_INTERVAL_MS,
	now: () => number = () => performance.now(),
): PlayheadClock {
	let live = 0;
	let committed = 0;
	let lastCommitAt = Number.NEGATIVE_INFINITY;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const liveListeners = new Set<() => void>();
	const committedListeners = new Set<() => void>();

	const commit = () => {
		timer = null;
		lastCommitAt = now();
		if (committed === live) return;
		committed = live;
		for (const listener of committedListeners) listener();
	};

	return {
		get: () => live,
		set: (timeSeconds) => {
			if (timeSeconds === live) return;
			live = timeSeconds;
			for (const listener of liveListeners) listener();
			if (timer !== null) return;
			// Leading edge commits a lone seek immediately; bursts trail by one interval.
			const wait = lastCommitAt + commitIntervalMs - now();
			if (wait <= 0) commit();
			else timer = setTimeout(commit, wait);
		},
		subscribe: (listener) => {
			liveListeners.add(listener);
			return () => liveListeners.delete(listener);
		},
		getCommitted: () => committed,
		subscribeCommitted: (listener) => {
			committedListeners.add(listener);
			return () => committedListeners.delete(listener);
		},
		// Subscribers detach themselves; this only cancels a pending trailing commit.
		dispose: () => {
			if (timer !== null) clearTimeout(timer);
			timer = null;
		},
	};
}

export const PlayheadClockContext = createContext<PlayheadClock | null>(null);

export function usePlayheadClock() {
	return useContext(PlayheadClockContext);
}

const noopSubscribe = () => () => undefined;

/**
 * Live playhead time in seconds. Falls back to `fallbackSeconds` when no clock
 * is provided (isolated component tests) or when `live` is false.
 */
export function useLivePlayheadTime(fallbackSeconds: number, live = true): number {
	const clock = usePlayheadClock();
	const enabled = live && clock !== null;
	const subscribe = useCallback(
		(listener: () => void) => (enabled && clock ? clock.subscribe(listener) : noopSubscribe()),
		[clock, enabled],
	);
	const getSnapshot = useCallback(
		() => (enabled && clock ? clock.get() : fallbackSeconds),
		[clock, enabled, fallbackSeconds],
	);
	return useSyncExternalStore(subscribe, getSnapshot);
}
