import { and, asc, eq } from 'drizzle-orm';
import { buildLibrary, idsWith, jsonWith, type Library } from 'comun/server/subsonic/library.ts';
import { db } from '#lib/server/db/index.ts';
import {
	album,
	albumArtistName,
	albumTitle,
	track,
	trackArtist,
	trackTitle
} from '#lib/server/db/schema.ts';
import { audioType, isOpus } from '#lib/server/music/tags.ts';

/** The house's music library for Subsonic (comun's), from its database. Its ids have no prefix. */
export {
	buildLibrary,
	indexLetter,
	matches,
	type Album,
	type Artist,
	type Library,
	type Stars
} from 'comun/server/subsonic/library.ts';

export const ids = idsWith('');
export const {
	artist: artistKey,
	album: albumKey,
	track: trackKey,
	playlist: playlistKey,
	radio: radioKey,
	parse: parseId
} = ids;
export const JSON_OF = jsonWith(ids);
export const { artist: artistJson, album: albumJson, song: songJson } = JSON_OF;

let cached: { at: number; library: Promise<Library> } | null = null;
/** The apps ask a lot, and often; a minute old is fresh enough for a library. */
const FRESH_MS = 60_000;

export function loadLibrary(): Promise<Library> {
	if (cached && Date.now() - cached.at < FRESH_MS) return cached.library;
	const library = db
		.select({
			id: track.id,
			albumId: album.id,
			title: trackTitle,
			artist: trackArtist,
			number: track.number,
			durationSec: track.durationSec,
			size: track.size,
			path: track.path,
			mtime: track.mtime,
			albumTitle: albumTitle,
			albumArtist: albumArtistName,
			coverStatus: album.coverStatus
		})
		.from(track)
		.innerJoin(album, eq(album.id, track.albumId))
		.where(and(eq(track.status, 'ready'), eq(track.missing, false)))
		.orderBy(asc(track.number), asc(track.path))
		.then((rows) =>
			buildLibrary(
				rows.map((r) => ({
					...r,
					hasCover: r.coverStatus === 'found',
					contentType: audioType(r.path),
					suffix: isOpus(r.path) ? 'opus' : 'flac'
				}))
			)
		);
	cached = { at: Date.now(), library };
	// A failed load is not kept.
	library.catch(() => (cached = null));
	return library;
}
