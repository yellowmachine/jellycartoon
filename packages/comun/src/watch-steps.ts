/** For the clocks: a save takes a moment to arrive, so a step may be a little over the time between. */
const SLACK_SEC = 1;

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

	/**
	 * Seconds watched since the last save of `key`: what the position moved forward, but never more
	 * than the time that went by, so jumping ahead counts only the moments really watched. 0 for the
	 * first save and for going back.
	 */
	step(key: string, positionSec: number, now = Date.now()) {
		const previous = this.#last.get(key);
		this.#last.set(key, { positionSec, at: now });
		if (this.#last.size > PRUNE_AT) this.#prune(now);
		if (!previous) return 0;
		const moved = positionSec - previous.positionSec;
		const elapsed = (now - previous.at) / 1000 + SLACK_SEC;
		return moved <= 0 ? 0 : Math.min(moved, elapsed);
	}

	get size() {
		return this.#last.size;
	}

	#prune(now: number) {
		for (const [key, { at }] of this.#last) if (now - at > STALE_MS) this.#last.delete(key);
	}
}
