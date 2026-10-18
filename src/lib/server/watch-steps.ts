/** More than this between two saves is a jump, not watching: they come every 5–10 seconds. */
export const MAX_STEP_SEC = 60;

/** A source not heard from in this long is forgotten: it would only start from 0 again. */
const STALE_MS = 60 * 60 * 1000;
/** Looked through for the stale ones only once there are this many. */
const PRUNE_AT = 200;

/**
 * How far each source moved forward since its last save: the time watched. By source (the living
 * room, or each browser session), not only by user and thing: the same episode on two screens at
 * once would otherwise mix their positions, and nothing would count (#45).
 */
export class WatchSteps {
	#last = new Map<string, { positionSec: number; at: number }>();

	/** Seconds watched since the last save of `key`; 0 for the first, going back or a jump. */
	step(key: string, positionSec: number, now = Date.now()) {
		const previous = this.#last.get(key);
		this.#last.set(key, { positionSec, at: now });
		if (this.#last.size > PRUNE_AT) this.#prune(now);
		const step = previous === undefined ? 0 : positionSec - previous.positionSec;
		return step <= 0 || step > MAX_STEP_SEC ? 0 : step;
	}

	get size() {
		return this.#last.size;
	}

	#prune(now: number) {
		for (const [key, { at }] of this.#last) if (now - at > STALE_MS) this.#last.delete(key);
	}
}
