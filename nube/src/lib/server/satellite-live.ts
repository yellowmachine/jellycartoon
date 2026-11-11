import { randomUUID } from 'node:crypto';

/**
 * What lives only in the server's memory about each satellite of Seilide (#296): its open channel
 * of notices (/api/satelite/avisos) and who is told when it changes, what it is to say once (#331,
 * #469), and whether it is there now and can ask for «Compañía» (#469). Apart from satellites.ts,
 * with no database, to be used and tested on its own.
 */

/** Those open on each satellite (its /api/satelite/avisos), told when it changes. */
const listeners = new Map<string, Set<() => void>>();

export function watchSatellite(id: string, listener: () => void) {
	const set = listeners.get(id) ?? new Set();
	set.add(listener);
	listeners.set(id, set);
	return () => void set.delete(listener);
}

/** This satellite told again what it has (a plug task for it, #396). */
export function nudgeSatellite(id: string) {
	for (const listener of listeners.get(id) ?? []) listener();
}

/** The same, for satellites.ts: its snapserver or its family's voice changed. */
export const tellSatellite = nudgeSatellite;

/** Said once (#331): what each satellite is to say, kept a while for it to come and say it. */
const SAY_MS = 10 * 60_000;
interface ToSay {
	id: string;
	text: string;
	until: number;
	/** Listened for after it, without the word, and the answer sent back (#469). */
	listen?: boolean;
	/** What it is said for, to take it back from all at once (`unsay`). */
	tag?: string;
}
const toSay = new Map<string, ToSay[]>();

/** For these satellites to say once, out loud: told to them at once. */
export function sayOnSatellites(
	ids: string[],
	text: string,
	{ listen, tag }: { listen?: boolean; tag?: string } = {}
) {
	const until = Date.now() + SAY_MS;
	for (const id of ids) {
		const kept = (toSay.get(id) ?? []).filter((s) => s.until > Date.now());
		toSay.set(id, [...kept, { id: randomUUID(), text, until, listen, tag }]);
		for (const listener of listeners.get(id) ?? []) listener();
	}
}

/** What was to be said for `tag`, and is not said yet, taken back (#469: answered at another). */
export function unsay(tag: string) {
	for (const [id, says] of toSay) {
		const kept = says.filter((s) => s.tag !== tag);
		if (kept.length === says.length) continue;
		toSay.set(id, kept);
		for (const listener of listeners.get(id) ?? []) listener();
	}
}

/** What it has still to say, oldest first. */
export const saysFor = (id: string) =>
	(toSay.get(id) ?? [])
		.filter((s) => s.until > Date.now())
		.map(({ id, text, listen }) => ({ id, text, ...(listen ? { listen } : {}) }));

/** Said: not again. */
export function saidOn(id: string, sayId: string) {
	toSay.set(
		id,
		(toSay.get(id) ?? []).filter((s) => s.id !== sayId)
	);
}

/**
 * Which satellites are connected now (their /api/satelite/avisos open), and whether each can do
 * what «Compañía» asks (#469: listen after a question and send the answer back), as it says on
 * connecting (`SATELLITE_CAN_HEADER`). In memory: after a restart of Seilide they come back in
 * a few seconds. And its last beat (/api/satelite/latido, every minute): a Pi unplugged at once
 * leaves its connection open here for many minutes, until the network gives up on it.
 */
const present = new Map<string, { connections: number; companion: number }>();
const beats = new Map<string, number>();
/** A beat older than this: not there, even if its connection still looks open. */
const BEAT_MS = 3 * 60_000;

/** Its beat, every minute. */
export const satelliteBeat = (id: string) => void beats.set(id, Date.now());

/** A satellite connected; the function, to call when it goes. */
export function satelliteHere(id: string, companion: boolean) {
	const p = present.get(id) ?? { connections: 0, companion: 0 };
	p.connections++;
	if (companion) p.companion++;
	present.set(id, p);
	// Connecting counts as a beat: there now, before its first.
	satelliteBeat(id);
	return () => {
		p.connections--;
		if (companion) p.companion--;
		if (!p.connections) present.delete(id);
	};
}

/** Of these, which are connected, and which of those can ask. */
export function presenceOf(ids: string[]) {
	const here = ids.filter((id) => present.has(id) && Date.now() - (beats.get(id) ?? 0) < BEAT_MS);
	return { here, canAsk: here.filter((id) => (present.get(id)?.companion ?? 0) > 0) };
}
