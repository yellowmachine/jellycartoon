import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { familyMember, houseKey, user } from './db/schema.ts';
import { asFamily, withFamily } from './family.ts';
import { houseKitchen, type Kitchen } from './fridge.ts';
import { houseKeyScope, newHouseKey } from './house-key-scope.ts';

/**
 * The keys the family gives its house (jellycartoon), for its voice and its TV to use the family's
 * fridge and recipes (/api/casa). The house sends the key and, when it knows who speaks, their
 * email (`x-persona`): what it writes goes in their name if they are of the family; otherwise, in
 * the house's (a voice satellite).
 */

const familyOfKey = houseKeyScope(db);

/** The kitchen a request of the house reaches: a 401 without a valid key. */
export async function houseRequest(request: Request): Promise<Kitchen> {
	const key = request.headers.get('x-api-key');
	const familyId = key ? await familyOfKey(key) : null;
	if (!familyId) error(401, 'Clave no válida');
	const email = request.headers.get('x-persona')?.trim().toLowerCase();
	if (!email) return houseKitchen(familyId);
	const [person] = await asFamily(familyId, (tx) =>
		tx
			.select({ id: familyMember.userId })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(eq(sql`lower(${user.email})`, email))
	);
	return { ...houseKitchen(familyId), userId: person?.id ?? null };
}

/** The family's keys, for Ajustes: never the keys, only how they start. */
export function listHouseKeys(userId: string) {
	return withFamily(userId, (tx) =>
		tx
			.select({
				id: houseKey.id,
				name: houseKey.name,
				start: houseKey.start,
				createdAt: houseKey.createdAt,
				lastUsedAt: houseKey.lastUsedAt
			})
			.from(houseKey)
	);
}

/** A new one: the key, shown once. */
export async function createHouseKey(userId: string, name: string) {
	const made = newHouseKey();
	await withFamily(userId, (tx, { familyId }) =>
		tx
			.insert(houseKey)
			.values({ id: randomUUID(), familyId, name, hash: made.hash, start: made.start })
	);
	return made.key;
}

export async function deleteHouseKey(userId: string, id: string) {
	await withFamily(userId, (tx) => tx.delete(houseKey).where(and(eq(houseKey.id, id))));
}
