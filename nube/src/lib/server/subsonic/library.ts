import { extname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { buildLibrary, idsWith, jsonWith, type Library } from 'comun/server/subsonic/library.ts';
import { musicSource, ownAlbum, ownTrack } from '../db/schema.ts';
import type { AnyDb } from '../family-scope.ts';

/** A family's bucket («Tu música», #534) as Subsonic sees it, from what was read of it. */

/** Seilide's own ids: the house's have none, and Tempus does not tell two servers' apart (#625). */
export const ids = idsWith('s-');
export const toJson = jsonWith(ids);

/** The family's library, inside its own transaction (asFamily); null, without a bucket. */
export async function readLibrary(tx: AnyDb): Promise<Library | null> {
	const [source] = await tx.select({ createdAt: musicSource.createdAt }).from(musicSource);
	if (!source) return null;
	const rows = await tx
		.select({ track: ownTrack, album: ownAlbum })
		.from(ownTrack)
		.innerJoin(ownAlbum, eq(ownAlbum.id, ownTrack.albumId))
		.orderBy(asc(ownTrack.disc), asc(ownTrack.number), asc(ownTrack.key));
	return buildLibrary(
		rows.map(({ track: t, album: a }) => ({
			id: t.id,
			albumId: a.id,
			title: t.title,
			artist: t.artist,
			disc: t.disc,
			number: t.number,
			durationSec: t.durationSec,
			size: t.size,
			path: t.key,
			contentType: t.mime.split(';')[0]!,
			suffix: extname(t.key).slice(1).toLowerCase(),
			// When each file came is not known: all the bucket's, the newest by its id.
			mtime: source.createdAt,
			albumTitle: a.customTitle ?? a.title,
			albumArtist: a.customArtist ?? a.artist,
			year: a.year,
			hasCover: Boolean(a.coverKey || a.coverFile)
		}))
	);
}

/** The apps ask a lot, and often; a minute old is fresh enough. */
const FRESH_MS = 60_000;
/** The most families' kept at once: past it, the oldest goes. */
const MAX_KEPT = 50;

/** Each family's, kept a minute. */
export function libraries(read: (familyId: string) => Promise<Library | null>) {
	const kept = new Map<string, { at: number; library: Promise<Library | null> }>();
	return (familyId: string) => {
		const cached = kept.get(familyId);
		if (cached && Date.now() - cached.at < FRESH_MS) return cached.library;
		kept.delete(familyId);
		if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value!);
		const entry = { at: Date.now(), library: read(familyId) };
		kept.set(familyId, entry);
		// A failed load is not kept.
		entry.library.catch(() => kept.get(familyId) === entry && kept.delete(familyId));
		return entry.library;
	};
}
