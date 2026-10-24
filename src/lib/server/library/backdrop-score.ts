/**
 * How good a frame is behind the top of a page (backdrop.ts), from ffmpeg's signalstats:
 * colourful, and neither dark nor washed out; a night scene or a white screen, last.
 */
export function backdropScore({ brightness, colour }: { brightness: number; colour: number }) {
	if (!Number.isFinite(brightness) || !Number.isFinite(colour)) return -Infinity;
	const dark = brightness < 45 ? 100 : 0;
	return colour - Math.abs(brightness - 120) / 3 - dark;
}
