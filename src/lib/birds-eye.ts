/** A film's bird's-eye view: frames spread over it, for the film page. */

export const FRAME_COUNT = 20;
/** Sizes the server makes frames in: the grid's, and the enlarged one's. */
export const FRAME_WIDTHS = [480, 1280] as const;

/**
 * Seconds of `count` frames evenly spread, skipping the logos at the start and the credits at the
 * end (longer, so more is skipped there).
 */
export function frameTimes(durationSec: number, count = FRAME_COUNT) {
	const margin = Math.min(Math.max(durationSec * 0.03, 20), 180);
	const first = margin;
	const last = durationSec - margin * 2;
	if (last <= first) return [Math.floor(durationSec / 2)];
	return Array.from({ length: count }, (_, i) =>
		Math.round(first + ((last - first) * i) / (count - 1))
	);
}
