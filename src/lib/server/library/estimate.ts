export interface QueueEstimateInput {
	/** Seconds of video converted per second, from recent conversions; null with no history. */
	speed: number | null;
	/** The episode converting now, if any. */
	current: { durationSec: number | null; elapsedSec: number; progress: number } | null;
	/** Durations of the pending episodes; null where the scan couldn't probe it. */
	pending: (number | null)[];
}

/** Below this the current episode's own speed is still too noisy to trust. */
const MIN_PROGRESS = 0.02;

/**
 * Seconds left until the queue is empty, or null when there is nothing to base it on.
 * Pending episodes without a known duration count as the average of the known ones.
 */
export function estimateQueue({ speed, current, pending }: QueueEstimateInput) {
	let currentLeft = 0;
	let currentSpeed: number | null = null;
	if (current) {
		const { durationSec, elapsedSec, progress } = current;
		if (progress >= MIN_PROGRESS && elapsedSec > 0) {
			currentLeft = (elapsedSec * (1 - progress)) / progress;
			if (durationSec) currentSpeed = (progress * durationSec) / elapsedSec;
		} else if (durationSec && speed) {
			currentLeft = Math.max(0, durationSec / speed - elapsedSec);
		} else {
			return null;
		}
	}

	if (pending.length === 0) return currentLeft;
	const queueSpeed = speed ?? currentSpeed;
	const known = pending.filter((d): d is number => d !== null);
	if (!queueSpeed || known.length === 0) return null;
	const knownTotal = known.reduce((sum, d) => sum + d, 0);
	const total = knownTotal + (pending.length - known.length) * (knownTotal / known.length);
	return currentLeft + total / queueSpeed;
}
