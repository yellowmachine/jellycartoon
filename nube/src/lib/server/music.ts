import type { MusicAlbumSummary, MusicPass, MusicPlaylistSummary, MusicTrack } from '#lib/music.ts';
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

export const albums = async (who: Who) =>
	(await askHouse<{ albums: MusicAlbumSummary[] }>(who.id, who.email, '/musica/albumes')).albums;

export const albumTracks = async (who: Who, id: number) =>
	(await askHouse<{ album: { tracks: MusicTrack[] } }>(who.id, who.email, `/musica/albumes/${id}`))
		.album.tracks;

export const playlists = async (who: Who) =>
	(await askHouse<{ playlists: MusicPlaylistSummary[] }>(who.id, who.email, '/musica/listas'))
		.playlists;

export const playlistTracks = async (who: Who, id: number) =>
	(
		await askHouse<{ playlist: { tracks: MusicTrack[] } }>(
			who.id,
			who.email,
			`/musica/listas/${id}`
		)
	).playlist.tracks;

export const musicPass = (who: Who) =>
	askHouse<MusicPass>(who.id, who.email, '/musica/pase', { method: 'POST', body: '{}' });
