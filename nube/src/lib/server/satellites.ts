import { randomUUID } from 'node:crypto';
import { tellSatellite } from './satellite-live.ts';
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { voiceSatellite } from './db/schema.ts';
import { asFamily, withFamily } from './family.ts';
import { houseKitchen, type Kitchen } from './fridge.ts';
import { newSatelliteKey, satelliteKeyScope, type KeySatellite } from './satellite-key-scope.ts';

/**
 * The voice satellites Seilide serves (#296): given in Ajustes → Familia, each with its key, which
 * it sends (`x-api-key`) to the same paths it asked the house before (/api/voice/*,
 * /api/satelite/avisos). What it does goes in the house's name: anyone in the room.
 */

const satelliteOfKey = satelliteKeyScope(db);

export const MAX_SATELLITE_NAME = 40;

export {
	nudgeSatellite,
	presenceOf,
	saidOn,
	satelliteBeat,
	satelliteHere,
	sayOnSatellites,
	saysFor,
	tellSatellite,
	unsay,
	watchSatellite
} from './satellite-live.ts';

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
	tellSatellite(id);
}

/** Whether it is in «Modo conversación» (#361): it listens after each answer, without the word. */
export async function conversationOf(k: Kitchen, id: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ conversation: voiceSatellite.conversation })
			.from(voiceSatellite)
			.where(eq(voiceSatellite.id, id))
	);
	return row?.conversation ?? false;
}

/** «Modo conversación» on or off, in Ajustes: used from its next answer, nothing to tell it. */
export async function setConversation(userId: string, id: string, on: boolean) {
	await withFamily(userId, (tx) =>
		tx.update(voiceSatellite).set({ conversation: on }).where(eq(voiceSatellite.id, id))
	);
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

/** Every satellite of the family told again what it has (its voice changed, #296). */
export async function satellitesChanged(familyId: string) {
	for (const { id } of await familySatellites(familyId)) tellSatellite(id);
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
				conversation: voiceSatellite.conversation,
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
