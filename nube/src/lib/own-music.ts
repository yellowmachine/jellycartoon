import type { MusicAlbum, MusicTrack } from 'comun/music.ts';
import type { OwnAlbumRow, OwnTrackRow } from '#lib/server/own-music.ts';

/**
 * «Tu música» (#534) in the browser: its tracks as the player takes them (`src`, its own cover and
 * album), and whether this browser can play each.
 */

export type { OwnAlbumRow, OwnTrackRow };

export const ownAlbumUrl = (id: number) => `/musica/tu-musica/${id}`;
export const ownCoverUrl = (id: number, version?: string | null) =>
	`/api/music/own/covers/${id}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
export const ownTrackSrc = (id: number) => `/api/music/own/tracks/${id}`;

/** For the player: its address in Seilide, which sends it on to the bucket. */
export const asTrack = (
	t: OwnTrackRow,
	a: Pick<OwnAlbumRow, 'id' | 'title' | 'hasCover' | 'coverVersion'>
): MusicTrack => ({
	id: t.id,
	title: t.title,
	artist: t.artist,
	number: t.number,
	durationSec: t.durationSec,
	albumId: a.id,
	album: a.title,
	hasCover: false,
	src: ownTrackSrc(t.id),
	cover: a.hasCover ? ownCoverUrl(a.id, a.coverVersion) : undefined,
	home: ownAlbumUrl(a.id)
});

const said = new Map<string, boolean>();
let probe: HTMLAudioElement | null = null;

/** Whether this browser plays that type (an ALAC .m4a, a .wma: often not). */
export function playable(mime: string) {
	let can = said.get(mime);
	if (can === undefined) {
		probe ??= document.createElement('audio');
		can = probe.canPlayType(mime) !== '';
		said.set(mime, can);
	}
	return can;
}

/** An album's tracks this browser plays, for the player. */
export const playableTracks = (a: OwnAlbumRow) =>
	a.tracks.filter((t) => playable(t.mime)).map((t) => asTrack(t, a));

export const ownArtistUrl = (name: string) =>
	`/musica/tu-musica/artista/${encodeURIComponent(name)}`;

/** As Música's library shows an album (MusicLibrary): only what this browser plays. */
export const asAlbum = (a: OwnAlbumRow): MusicAlbum => ({
	id: a.id,
	title: a.title,
	artist: a.artist,
	hasCover: a.hasCover,
	cover: a.hasCover ? ownCoverUrl(a.id, a.coverVersion) : undefined,
	href: ownAlbumUrl(a.id),
	tracks: playableTracks(a)
});

/** Where the «+» of its songs adds: its own lists (#534, phase 2), not the house's. */
export const OWN_LISTS_API = '/api/music/own/playlists';
export const ownListUrl = (id: number) => `/musica/tu-musica/listas/${id}`;

/** Where a folder of the bucket is seen (Música → Carpetas, #534 phase 3). */
export const ownFolderUrl = (path: string) =>
	path
		? `/musica/tu-musica/carpetas?ruta=${encodeURIComponent(path)}`
		: '/musica/tu-musica/carpetas';
