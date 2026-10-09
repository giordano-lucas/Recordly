import { useTimelineContext } from "dnd-timeline";
import { getPlayheadDisplayTime, type ClipPresentation } from "../../core/clipPresentation";
import { formatPlayheadTime } from "../../core/time";

interface RangeSelectionOverlayProps {
	range: { startMs: number; endMs: number } | null;
	clips: ClipPresentation[];
}

/** The I/O range: a tinted band across every track with edge handles. */
export default function RangeSelectionOverlay({ range, clips }: RangeSelectionOverlayProps) {
	const { sidebarWidth, direction, range: view, valueToPixels } = useTimelineContext();
	if (!range) return null;
	const start = Math.max(range.startMs, view.start);
	const end = Math.min(range.endMs, view.end);
	if (end <= start) return null;
	const left = valueToPixels(getPlayheadDisplayTime(start, clips) - view.start);
	const right = valueToPixels(getPlayheadDisplayTime(end, clips) - view.start);
	const sideProperty = direction === "rtl" ? "right" : "left";
	return (
		<div
			data-testid="timeline-range-selection"
			aria-label={`Range ${formatPlayheadTime(range.startMs)} to ${formatPlayheadTime(range.endMs)}`}
			className="pointer-events-none absolute top-0 bottom-0 z-40 border-x-2 border-amber-400 bg-amber-400/15"
			style={{ [sideProperty]: sidebarWidth + left, width: Math.max(2, right - left) }}
		/>
	);
}
