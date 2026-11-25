import { fold } from '../../music.ts';

/**
 * A music library as Subsonic sees it: artists (the albums' artist), albums and tracks, with the
 * protocol's ids: `ar-…`, `al-…`, `tr-…`. There is no artist table, so an artist's id is its name.
 * The house's (#27) and, in Seilide, a family's bucket (#625).
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
	contentType: string;
	suffix: string;
	/** The disc of an album with several, if known. */
	disc?: number | null;
	created: Date;
}

export interface Album {
	id: number;
	title: string;
	artist: string;
	hasCover: boolean;
	year?: number | null;
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

/**
 * The ids, with a prefix of the server's own before them (Seilide's, `s-`; the house's, none).
 * Tempus keeps its downloads and its history by the song's id alone, not the server's: the same
 * ones in two servers would be taken one for the other (#625).
 */
export function idsWith(prefix: string) {
	return {
		artist: (name: string) => `${prefix}ar-${Buffer.from(name, 'utf8').toString('base64url')}`,
		album: (id: number) => `${prefix}al-${id}`,
		track: (id: number) => `${prefix}tr-${id}`,
		playlist: (id: number) => `${prefix}pl-${id}`,
		/** A radio station, by its Radio Browser id. */
		radio: (uuid: string) => `${prefix}rd-${uuid}`,
		/** What an id points to; null if it is none of ours. */
		parse(id: string | null) {
			if (!id?.startsWith(prefix)) return null;
			const match = /^(ar|al|tr|pl|rd)-(.+)$/.exec(id.slice(prefix.length));
			if (!match) return null;
			if (match[1] === 'rd') return { kind: 'radio' as const, uuid: match[2] };
			if (match[1] === 'ar')
				return {
					kind: 'artist' as const,
					name: Buffer.from(match[2], 'base64url').toString('utf8')
				};
			const n = Number(match[2]);
			if (!Number.isInteger(n)) return null;
			const kind = ({ al: 'album', tr: 'track', pl: 'playlist' } as const)[
				match[1] as 'al' | 'tr' | 'pl'
			];
			return { kind, id: n };
		}
	};
}

export type Ids = ReturnType<typeof idsWith>;

/** The user's favourites, by id: when each was marked. */
export type Stars = Map<string, Date>;
const starredAt = (stars: Stars | undefined, key: string) => stars?.get(key)?.toISOString();

/** The index an artist goes under: its first letter without accents, or «#». */
export function indexLetter(name: string) {
	const first = fold(name.trim())[0]?.toUpperCase() ?? '#';
	return /[A-Z]/.test(first) ? first : '#';
}

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

/** Built from the rows of the database. */
export function buildLibrary(
	rows: (Omit<Track, 'created'> & {
		mtime: Date;
		albumTitle: string;
		albumArtist: string;
		hasCover: boolean;
		year?: number | null;
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
				year: r.year,
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
			contentType: r.contentType,
			suffix: r.suffix,
			disc: r.disc,
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

export const sortedArtists = (library: Library) =>
	[...library.artists.values()].sort((a, b) => byName(a.name, b.name));

const albumDuration = (a: Album) =>
	Math.round(a.tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0));

/** Artists, albums and songs as the protocol has them (ID3), with the server's ids. */
export function jsonWith(ids: Ids) {
	return {
		artist: (artist: Artist, stars?: Stars) => ({
			id: ids.artist(artist.name),
			starred: starredAt(stars, ids.artist(artist.name)),
			name: artist.name,
			albumCount: artist.albums.length,
			coverArt: artist.albums.find((a) => a.hasCover)
				? ids.album(artist.albums.find((a) => a.hasCover)!.id)
				: undefined
		}),
		album: (a: Album, stars?: Stars) => ({
			id: ids.album(a.id),
			starred: starredAt(stars, ids.album(a.id)),
			name: a.title,
			title: a.title,
			album: a.title,
			artist: a.artist,
			artistId: ids.artist(a.artist),
			coverArt: a.hasCover ? ids.album(a.id) : undefined,
			songCount: a.tracks.length,
			duration: albumDuration(a),
			year: a.year ?? undefined,
			created: a.created.toISOString(),
			isDir: true
		}),
		song: (t: Track, a: Album, stars?: Stars) => ({
			id: ids.track(t.id),
			starred: starredAt(stars, ids.track(t.id)),
			parent: ids.album(a.id),
			isDir: false,
			title: t.title,
			album: a.title,
			artist: t.artist,
			track: t.number ?? undefined,
			discNumber: t.disc ?? undefined,
			year: a.year ?? undefined,
			coverArt: a.hasCover ? ids.album(a.id) : undefined,
			size: t.size,
			contentType: t.contentType,
			suffix: t.suffix,
			duration: t.durationSec ? Math.round(t.durationSec) : undefined,
			path: t.path,
			albumId: ids.album(a.id),
			artistId: ids.artist(a.artist),
			type: 'music',
			mediaType: 'song',
			isVideo: false,
			created: t.created.toISOString()
		})
	};
}

export type Json = ReturnType<typeof jsonWith>;

/** Whether `text` contains every word of the search, without accents nor case. */
export function matches(text: string, query: string) {
	const haystack = fold(text);
	return fold(query)
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}
