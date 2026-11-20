import { gameSource, house, musicSource } from './db/schema.ts';
import { withFamily } from './family.ts';

/**
 * What the family has to fill the house's sections of the bar (nav.ts' Reach): a house connected,
 * and its own buckets, «Tu música» (#534) and «Tus juegos» (#564), which open Música and Juegos
 * without a house.
 */
export async function sectionReach(userId: string) {
	return withFamily(userId, async (tx) => {
		// One after another: one transaction, one connection.
		const [h] = await tx.select({ id: house.familyId }).from(house);
		const [m] = await tx.select({ id: musicSource.familyId }).from(musicSource);
		const [g] = await tx.select({ id: gameSource.familyId }).from(gameSource);
		return { house: Boolean(h), music: Boolean(m), games: Boolean(g) };
	});
}
