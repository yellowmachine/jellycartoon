import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { asc, eq, isNotNull } from 'drizzle-orm';
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

/**
 * Those that already talk to Seilide (they have connected with their key): their alarms ring here,
 * not at the house. One adopted from the house that still talks to it, there, until it does.
 */
export function servedSatellites(familyId: string) {
	return asFamily(familyId, (tx) =>
		tx
			.select({ id: voiceSatellite.id, name: voiceSatellite.name })
			.from(voiceSatellite)
			.where(isNotNull(voiceSatellite.lastSeenAt))
	);
}

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

/**
 * A new one, or one of the house's (`adopt`, its id), which keeps its id and with it its place:
 * its alarms, what it learned. The key, shown once.
 */
export async function createSatellite(userId: string, name: string, adopt: string | null) {
	const clean = name.trim().slice(0, MAX_SATELLITE_NAME);
	const made = newSatelliteKey();
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	const fromHouse = adopt
		? (await houseSatellites(familyId)).find((s) => s.id === adopt)
		: undefined;
	if (adopt && !fromHouse) error(400, 'La casa no tiene ese satélite');
	await withFamily(userId, async (tx) => {
		await tx.insert(voiceSatellite).values({
			id: fromHouse?.id ?? randomUUID(),
			familyId,
			name: clean || fromHouse?.name || 'Satélite',
			hash: made.hash,
			start: made.start
		});
	});
	return made.key;
}

export async function deleteSatellite(userId: string, id: string) {
	await withFamily(userId, (tx) => tx.delete(voiceSatellite).where(eq(voiceSatellite.id, id)));
}
