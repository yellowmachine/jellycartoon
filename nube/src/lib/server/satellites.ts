import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { voiceSatellite } from './db/schema.ts';
import { asFamily, withFamily } from './family.ts';
import { houseKitchen, type Kitchen } from './fridge.ts';
import { houseSatellites } from './house.ts';
import { newSatelliteKey, satelliteKeyScope, type KeySatellite } from './satellite-key-scope.ts';

/**
 * The voice satellites Seilide serves (#296): given in Ajustes → Familia, each with its key, which
 * it sends (`x-api-key`) to the same paths it asked the house before (/api/voice/*,
 * /api/satelite/avisos). What it does goes in the house's name: anyone in the room.
 */

const satelliteOfKey = satelliteKeyScope(db);

export const MAX_SATELLITE_NAME = 40;

/** Those open on each satellite (its /api/satelite/avisos), told when it changes. */
const listeners = new Map<string, Set<() => void>>();

export function watchSatellite(id: string, listener: () => void) {
	const set = listeners.get(id) ?? new Set();
	set.add(listener);
	listeners.set(id, set);
	return () => void set.delete(listener);
}

/** Said once (#331): what each satellite is to say, kept a while for it to come and say it. */
const SAY_MS = 10 * 60_000;
const toSay = new Map<string, { id: string; text: string; until: number }[]>();

/** For these satellites to say once, out loud: told to them at once. */
export function sayOnSatellites(ids: string[], text: string) {
	const until = Date.now() + SAY_MS;
	for (const id of ids) {
		const kept = (toSay.get(id) ?? []).filter((s) => s.until > Date.now());
		toSay.set(id, [...kept, { id: randomUUID(), text, until }]);
		for (const listener of listeners.get(id) ?? []) listener();
	}
}

/** What it has still to say, oldest first. */
export const saysFor = (id: string) =>
	(toSay.get(id) ?? []).filter((s) => s.until > Date.now()).map(({ id, text }) => ({ id, text }));

/** Said: not again. */
export function saidOn(id: string, sayId: string) {
	toSay.set(
		id,
		(toSay.get(id) ?? []).filter((s) => s.id !== sayId)
	);
}

/** Its snapserver, as saved; null, none. */
export async function snapserverOf(k: Kitchen, id: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ snapserver: voiceSatellite.snapserver })
			.from(voiceSatellite)
			.where(eq(voiceSatellite.id, id))
	);
	return row?.snapserver ?? null;
}

/** Its snapserver changed, in Ajustes: told to it at once. */
export async function setSnapserver(userId: string, id: string, snapserver: string | null) {
	await withFamily(userId, (tx) =>
		tx.update(voiceSatellite).set({ snapserver }).where(eq(voiceSatellite.id, id))
	);
	for (const listener of listeners.get(id) ?? []) listener();
}

/** The satellite a request comes from, and its family's kitchen: a 401 without a valid key. */
export async function satelliteRequest(
	request: Request
): Promise<{ k: Kitchen; satellite: KeySatellite }> {
	const key = request.headers.get('x-api-key');
	const satellite = key ? await satelliteOfKey(key) : null;
	if (!satellite) error(401, 'Clave no válida');
	return { k: houseKitchen(satellite.familyId), satellite };
}

/** The family's, by name: for its alarms and its voice, where they can sound. */
export function familySatellites(familyId: string) {
	return asFamily(familyId, (tx) =>
		tx
			.select({ id: voiceSatellite.id, name: voiceSatellite.name })
			.from(voiceSatellite)
			.orderBy(asc(voiceSatellite.name))
	);
}

/** Its own and the house's: every place an alarm can sound (the Agenda, its banner). */
export async function allSatellites(familyId: string) {
	const [own, house] = await Promise.all([familySatellites(familyId), houseSatellites(familyId)]);
	return [...own, ...house];
}

/**
 * How its own snapclient is known on the house's Snapcast (snapclient.ts in the satellite, told
 * by its channel): the house plays «aquí» and lowers its music by it.
 */
export const snapclientIdOf = (id: string) => `satelite-${id.slice(0, 8)}`;

/** For Ajustes: never the keys, only how they start. */
export function listSatellites(userId: string) {
	return withFamily(userId, (tx) =>
		tx
			.select({
				id: voiceSatellite.id,
				name: voiceSatellite.name,
				start: voiceSatellite.start,
				snapserver: voiceSatellite.snapserver,
				createdAt: voiceSatellite.createdAt,
				lastSeenAt: voiceSatellite.lastSeenAt
			})
			.from(voiceSatellite)
			.orderBy(asc(voiceSatellite.name))
	);
}

/** A new one: its key, shown once. */
export async function createSatellite(userId: string, name: string) {
	const made = newSatelliteKey();
	await withFamily(userId, (tx, { familyId }) =>
		tx.insert(voiceSatellite).values({
			id: randomUUID(),
			familyId,
			name: name.trim().slice(0, MAX_SATELLITE_NAME) || 'Satélite',
			hash: made.hash,
			start: made.start
		})
	);
	return made.key;
}

export async function deleteSatellite(userId: string, id: string) {
	await withFamily(userId, (tx) => tx.delete(voiceSatellite).where(eq(voiceSatellite.id, id)));
}
