import { eq } from 'drizzle-orm';
import { familyMember, house, musicSource } from './db/schema.ts';
import { withFamily } from './family.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Where Música's music comes from (#534, phase 3): the house's (its tunnel) or the family's own
 * bucket («Tu música»). Música shows one at a time, as it was before there were two: its albums, its
 * lists and its folders. Each person chooses in Ajustes → Para mí when the family has both; with
 * one, that one. The voice, too, only looks in the chosen one.
 */
export type MusicSourceKind = 'casa' | 'propia';

export interface MusicSources {
	house: boolean;
	own: boolean;
	/** What the person chose; null, nothing (the house's). */
	chosen: MusicSourceKind | null;
	/** The one Música shows now: without either, the house's (and its notice). */
	current: MusicSourceKind;
}

export const isMusicSource = (v: unknown): v is MusicSourceKind => v === 'casa' || v === 'propia';

/** As one query: whether there is each source, and the person's choice. */
export async function musicSources(userId: string): Promise<MusicSources> {
	return withFamily(userId, async (tx) => {
		// One after another: one transaction, one connection.
		const [h] = await tx.select({ id: house.familyId }).from(house);
		const [o] = await tx.select({ id: musicSource.familyId }).from(musicSource);
		const [me] = await tx
			.select({ chosen: familyMember.musicSource })
			.from(familyMember)
			.where(eq(familyMember.userId, userId));
		const has = { house: Boolean(h), own: Boolean(o) };
		const chosen = isMusicSource(me?.chosen) ? me.chosen : null;
		return { ...has, chosen, current: currentOf(has, chosen) };
	});
}

/** With both, the chosen one (the house's by default); with one, that one. */
export function currentOf(
	has: { house: boolean; own: boolean },
	chosen: MusicSourceKind | null
): MusicSourceKind {
	if (has.house && has.own) return chosen ?? 'casa';
	return has.own ? 'propia' : 'casa';
}

/** The person's, by their kitchen (the voice); a satellite, no one's: the house's. */
export async function musicSourceOf(k: Kitchen): Promise<MusicSourceKind> {
	return k.userId ? (await musicSources(k.userId)).current : 'casa';
}

export async function setMusicSource(userId: string, kind: MusicSourceKind) {
	await withFamily(userId, (tx) =>
		tx.update(familyMember).set({ musicSource: kind }).where(eq(familyMember.userId, userId))
	);
}
