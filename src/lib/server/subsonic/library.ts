import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	album,
	albumArtistName,
	albumTitle,
	track,
	trackArtist,
	trackTitle
} from '#lib/server/db/schema.ts';
import { fold } from 'comun/music.ts';
import { audioType, isOpus } from '#lib/server/music/tags.ts';

/**
 * The music library as Subsonic sees it: artists (the albums' artist), albums and tracks, with the
 * protocol's ids: `ar-…`, `al-…`, `tr-…`. There is no artist table, so an artist's id is its name.
 */

export interface Track {
	id: number;
	albumId: number;
	title: string;
	artist: string;
	number: number | null;
	durationSec: number | null;
	size: number;
	path: string;
	created: Date;
}

export interface Album {
	id: number;
	title: string;
	artist: string;
	hasCover: boolean;
	tracks: Track[];
	created: Date;
}

export interface Artist {
	name: string;
	albums: Album[];
}

export interface Library {
	albums: Map<number, Album>;
	tracks: Map<number, Track>;
	/** By the folded name: «Beyoncé» and «beyonce» are the same artist. */
	artists: Map<string, Artist>;
}

export const artistKey = (name: string) => `ar-${Buffer.from(name, 'utf8').toString('base64url')}`;
export const albumKey = (id: number) => `al-${id}`;
export const trackKey = (id: number) => `tr-${id}`;
export const playlistKey = (id: number) => `pl-${id}`;
/** A radio station, by its Radio Browser id. */
export const radioKey = (uuid: string) => `rd-${uuid}`;

/** What an id points to; null if it is none of ours. */
export function parseId(id: string | null) {
	const match = /^(ar|al|tr|pl|rd)-(.+)$/.exec(id ?? '');
	if (!match) return null;
	if (match[1] === 'rd') return { kind: 'radio' as const, uuid: match[2] };
	if (match[1] === 'ar')
		return { kind: 'artist' as const, name: Buffer.from(match[2], 'base64url').toString('utf8') };
	const n = Number(match[2]);
	if (!Number.isInteger(n)) return null;
	const kind = ({ al: 'album', tr: 'track', pl: 'playlist' } as const)[
		match[1] as 'al' | 'tr' | 'pl'
	];
	return { kind, id: n };
}

/** The user's favourites, by id: when each was marked. */
export type Stars = Map<string, Date>;
const starredAt = (stars: Stars | undefined, key: string) => stars?.get(key)?.toISOString();

/** The index an artist goes under: its first letter without accents, or «#». */
export function indexLetter(name: string) {
	const first = fold(name.trim())[0]?.toUpperCase() ?? '#';
	return /[A-Z]/.test(first) ? first : '#';
}

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

/** Built from the rows: what loadLibrary does after asking the database. */
export function buildLibrary(
	rows: (Omit<Track, 'created'> & {
		mtime: Date;
		albumTitle: string;
		albumArtist: string;
		hasCover: boolean;
	})[]
): Library {
	const albums = new Map<number, Album>();
	const tracks = new Map<number, Track>();
	for (const r of rows) {
		let a = albums.get(r.albumId);
		if (!a) {
			a = {
				id: r.albumId,
				title: r.albumTitle,
				artist: r.albumArtist,
				hasCover: r.hasCover,
				tracks: [],
				created: r.mtime
			};
			albums.set(r.albumId, a);
		}
		const t: Track = {
			id: r.id,
			albumId: r.albumId,
			title: r.title,
			artist: r.artist,
			number: r.number,
			durationSec: r.durationSec,
			size: r.size,
			path: r.path,
			created: r.mtime
		};
		a.tracks.push(t);
		// An album is as new as its newest file.
		if (r.mtime > a.created) a.created = r.mtime;
		tracks.set(t.id, t);
	}
	const artists = new Map<string, Artist>();
	for (const a of albums.values()) {
		const key = fold(a.artist);
		const artist = artists.get(key) ?? { name: a.artist, albums: [] };
		artist.albums.push(a);
		artists.set(key, artist);
	}
	for (const artist of artists.values()) artist.albums.sort((x, y) => byName(x.title, y.title));
	return { albums, tracks, artists };
}

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
		.then((rows) => buildLibrary(rows.map((r) => ({ ...r, hasCover: r.coverStatus === 'found' }))));
	cached = { at: Date.now(), library };
	// A failed load is not kept.
	library.catch(() => (cached = null));
	return library;
}

export const sortedArtists = (library: Library) =>
	[...library.artists.values()].sort((a, b) => byName(a.name, b.name));

const albumDuration = (a: Album) =>
	Math.round(a.tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0));

/** An artist as the protocol has it (ID3). */
export const artistJson = (artist: Artist, stars?: Stars) => ({
	id: artistKey(artist.name),
	starred: starredAt(stars, artistKey(artist.name)),
	name: artist.name,
	albumCount: artist.albums.length,
	coverArt: artist.albums.find((a) => a.hasCover)
		? albumKey(artist.albums.find((a) => a.hasCover)!.id)
		: undefined
});

export const albumJson = (a: Album, stars?: Stars) => ({
	id: albumKey(a.id),
	starred: starredAt(stars, albumKey(a.id)),
	name: a.title,
	title: a.title,
	album: a.title,
	artist: a.artist,
	artistId: artistKey(a.artist),
	coverArt: a.hasCover ? albumKey(a.id) : undefined,
	songCount: a.tracks.length,
	duration: albumDuration(a),
	created: a.created.toISOString(),
	isDir: true
});

export const songJson = (t: Track, a: Album, stars?: Stars) => ({
	id: trackKey(t.id),
	starred: starredAt(stars, trackKey(t.id)),
	parent: albumKey(a.id),
	isDir: false,
	title: t.title,
	album: a.title,
	artist: t.artist,
	track: t.number ?? undefined,
	coverArt: a.hasCover ? albumKey(a.id) : undefined,
	size: t.size,
	contentType: audioType(t.path),
	suffix: isOpus(t.path) ? 'opus' : 'flac',
	duration: t.durationSec ? Math.round(t.durationSec) : undefined,
	path: t.path,
	albumId: albumKey(a.id),
	artistId: artistKey(a.artist),
	type: 'music',
	mediaType: 'song',
	isVideo: false,
	created: t.created.toISOString()
});

/** Whether `text` contains every word of the search, without accents nor case. */
export function matches(text: string, query: string) {
	const haystack = fold(text);
	return fold(query)
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}
