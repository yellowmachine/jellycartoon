/** A film's bird's-eye view: frames spread over it, for the film page. */

/** How many frames it can show. */
export const FRAME_COUNTS = [10, 20, 30] as const;
export type FrameCount = (typeof FRAME_COUNTS)[number];
export const FRAME_COUNT: FrameCount = 20;
/** Sizes the server makes frames in: the grid's, and the enlarged one's. */
export const FRAME_WIDTHS = [480, 1280] as const;

/** Length of the clip of a moment that plays in the browser. */
export const CLIP_SECONDS = 30;

/** Mulberry32: a small seeded generator of numbers in [0, 1), the same ones for the same seed. */
function seededRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Seconds of `count` frames, skipping the logos at the start and the credits at the end (longer,
 * so more is skipped there). The film is cut in `count` equal stretches and each frame falls at a
 * random moment of its own: spread from beginning to end, but not on a rigid grid. The randomness
 * comes from `seed` (the film's id), so a film always shows the same frames.
 */
export function frameTimes(durationSec: number, seed: number, count: number = FRAME_COUNT) {
	const margin = Math.min(Math.max(durationSec * 0.03, 20), 180);
	const first = margin;
	const last = durationSec - margin * 2;
	if (last <= first) return [Math.floor(durationSec / 2)];
	const random = seededRandom(seed);
	const stretch = (last - first) / count;
	const times = Array.from({ length: count }, (_, i) =>
		Math.floor(first + stretch * (i + random()))
	);
	// A very short film can round two frames to the same second.
	return [...new Set(times)];
}
