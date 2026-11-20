import { eq } from 'drizzle-orm';
import { familyMember, gameSource, house } from './db/schema.ts';
import { withFamily } from './family.ts';
import { currentOf, isMusicSource, type MusicSourceKind } from './music-source.ts';

/**
 * Where Juegos' games come from (#564), as Música's music (music-source.ts): the house's (its
 * tunnel) or the family's own bucket («Tus juegos»). One at a time, chosen by each person in
 * Ajustes → Para mí when the family has both; with one, that one.
 */
export type GameSourceKind = MusicSourceKind;

export interface GameSources {
	house: boolean;
	own: boolean;
	/** What the person chose; null, nothing (the house's). */
	chosen: GameSourceKind | null;
	/** The one Juegos shows now: without either, the house's (and its notice). */
	current: GameSourceKind;
}

export const isGameSource = isMusicSource;

/** As one query: whether there is each source, and the person's choice. */
export async function gameSources(userId: string): Promise<GameSources> {
	return withFamily(userId, async (tx) => {
		// One after another: one transaction, one connection.
		const [h] = await tx.select({ id: house.familyId }).from(house);
		const [o] = await tx.select({ id: gameSource.familyId }).from(gameSource);
		const [me] = await tx
			.select({ chosen: familyMember.gameSource })
			.from(familyMember)
			.where(eq(familyMember.userId, userId));
		const has = { house: Boolean(h), own: Boolean(o) };
		const chosen = isGameSource(me?.chosen) ? me.chosen : null;
		return { ...has, chosen, current: currentOf(has, chosen) };
	});
}

/** Whether this person's Juegos is the family's bucket now. */
export const playsOwnGames = async (userId: string) =>
	(await gameSources(userId)).current === 'propia';

export async function setGameSource(userId: string, kind: GameSourceKind) {
	await withFamily(userId, (tx) =>
		tx.update(familyMember).set({ gameSource: kind }).where(eq(familyMember.userId, userId))
	);
}
