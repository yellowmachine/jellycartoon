import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Each family's lane to OpenRouter, by its key (#331): what someone is waiting for (an order, its
 * spoken answer, a phrase while the AI thinks) goes at once; what works in the background
 * (learning, a rule's meaning, the night's proposals) waits until nothing of the first is under way
 * and a moment more, and goes one at a time. OpenRouter adds up what every request under way could
 * cost and refuses one that goes over the credit left (a 402, «given your current in-flight
 * requests»), so the background must not take the voice's room.
 */

const background = new AsyncLocalStorage<true>();

/** What `fn` asks OpenRouter, behind what someone is waiting for. */
export const inBackground = <T>(fn: () => Promise<T>) => background.run(true, fn);

interface Lane {
	/** In the foreground, under way. */
	front: number;
	/** When the last one of them ended. */
	lastFront: number;
	/** The background's queue: its last one. */
	back: Promise<unknown>;
}

const lanes = new Map<string, Lane>();
/** After the foreground, this long before the background (the voice's next phrase may follow). */
const SETTLE_MS = 3_000;
const LOOK_MS = 500;

const laneOf = (apiKey: string) => {
	let lane = lanes.get(apiKey);
	if (!lane) lanes.set(apiKey, (lane = { front: 0, lastFront: 0, back: Promise.resolve() }));
	return lane;
};

const quiet = (lane: Lane) => !lane.front && Date.now() - lane.lastFront >= SETTLE_MS;

/** A request to OpenRouter with this key, in its lane: at once, or behind (`inBackground`). */
export async function throughLane<T>(apiKey: string, fn: () => Promise<T>): Promise<T> {
	const lane = laneOf(apiKey);
	if (!background.getStore()) {
		lane.front++;
		try {
			return await fn();
		} finally {
			lane.front--;
			lane.lastFront = Date.now();
		}
	}
	const turn = lane.back.then(async () => {
		while (!quiet(lane)) await sleep(LOOK_MS);
		return fn();
	});
	lane.back = turn.catch(() => {});
	return turn;
}

/** How long this key has had nothing in the foreground (0, something under way now). */
export function quietFor(apiKey: string) {
	const lane = lanes.get(apiKey);
	if (!lane) return Infinity;
	return lane.front ? 0 : Date.now() - lane.lastFront;
}
