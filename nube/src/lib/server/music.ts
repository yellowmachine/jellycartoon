import type { MusicTrack } from 'comun/music.ts';
import { askHouse } from './house.ts';

/**
 * The house's music, for the road mode (#253): asked of its API with the family's house link
 * (house.ts), in the name of who is listening. The audio itself, by a pass: the page opens it
 * straight from the house, not through here.
 */

interface Who {
	id: string;
	email: string;
}

export interface AlbumSummary {
	id: number;
	title: string;
	artist: string;
	hasCover: boolean;
	tracks: number;
	durationSec: number;
}

export interface PlaylistSummary {
	id: number;
	name: string;
	total: number;
	durationSec: number;
}

/** Where the house's tracks and covers are, for a while (a signed pass). */
export interface MusicPass {
	base: string;
	expires: string;
}

export const albums = async (who: Who) =>
	(await askHouse<{ albums: AlbumSummary[] }>(who.id, who.email, '/musica/albumes')).albums;

export const albumTracks = async (who: Who, id: number) =>
	(await askHouse<{ album: { tracks: MusicTrack[] } }>(who.id, who.email, `/musica/albumes/${id}`))
		.album.tracks;

export const playlists = async (who: Who) =>
	(await askHouse<{ playlists: PlaylistSummary[] }>(who.id, who.email, '/musica/listas')).playlists;

export const playlistTracks = async (who: Who, id: number) =>
	(
		await askHouse<{ playlist: { tracks: MusicTrack[] } }>(
			who.id,
			who.email,
			`/musica/listas/${id}`
		)
	).playlist.tracks;

/** «Todo aleatorio»: tracks from all the music, in random order. */
export const randomTracks = async (who: Who) =>
	(await askHouse<{ tracks: MusicTrack[] }>(who.id, who.email, '/musica/aleatorio')).tracks;

export const musicPass = (who: Who) =>
	askHouse<MusicPass>(who.id, who.email, '/musica/pase', { method: 'POST', body: '{}' });
