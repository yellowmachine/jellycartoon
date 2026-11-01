import type { DjOptions, DjPreset, MusicAlbum, MusicTrack } from 'comun/music.ts';
import { askHouse } from './house.ts';

/**
 * The house's music, for Música and the road mode (#253): asked of its API with the family's house
 * link (house.ts), in the name of who is listening. The audio itself, by a pass: the page opens it
 * straight from the house, not through here. Its playlists and Modo DJ are the house's too.
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
	/** The same pass for the episodes' thumbnails and the series' backgrounds (Series). */
	images: string;
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

/** Every album with its tracks: Música searches them in the browser and groups them by artist. */
export const catalog = async (who: Who) =>
	(await askHouse<{ albums: MusicAlbum[] }>(who.id, who.email, '/musica/catalogo')).albums;

export interface PlaylistItem {
	itemId: number;
	track: MusicTrack;
}

export const playlist = async (who: Who, id: number) =>
	(
		await askHouse<{
			playlist: { id: number; name: string; tracks: MusicTrack[]; items: PlaylistItem[] };
		}>(who.id, who.email, `/musica/listas/${id}`)
	).playlist;

/**
 * A new playlist, its id back; with `trackIds`, those songs in it in that order (the queue saved as
 * a list). A house from before takes only the name: then they go in one by one.
 */
export async function createPlaylist(who: Who, name: string, trackIds: number[] = []) {
	const { id, added } = await askHouse<{ id: number; added?: number }>(
		who.id,
		who.email,
		'/musica/listas',
		{ method: 'POST', body: JSON.stringify({ name, trackIds }) }
	);
	if (added === undefined)
		for (const trackId of trackIds) await changePlaylist(who, id, { action: 'add', trackId });
	return id;
}

/** `rename` (`name`), `add` (`trackId`), `remove`, `up` or `down` (`itemId`). */
export type PlaylistChange =
	| { action: 'rename'; name: string }
	| { action: 'add'; trackId: number }
	| { action: 'remove' | 'up' | 'down'; itemId: number };

export const changePlaylist = (who: Who, id: number, change: PlaylistChange) =>
	askHouse(who.id, who.email, `/musica/listas/${id}`, {
		method: 'POST',
		body: JSON.stringify(change)
	});

export const deletePlaylist = (who: Who, id: number) =>
	askHouse(who.id, who.email, `/musica/listas/${id}`, { method: 'DELETE' });

/**
 * Modo DJ, the house's: whether it has a voice, whether one can be chosen, their setups. Without
 * it (a house from before, or none), no Modo DJ: the rest of the music goes on.
 */
export const djInfo = (who: Who) =>
	askHouse<{ enabled: boolean; voices: boolean; presets: DjPreset[] }>(
		who.id,
		who.email,
		'/musica/dj'
	).catch(() => ({ enabled: false, voices: false, presets: [] as DjPreset[] }));

/** Saved with a name: new, or `id` changed. Its id back. */
export const saveDjPreset = async (
	who: Who,
	preset: { id: number | null; name: string; options: DjOptions }
) =>
	(
		await askHouse<{ id: number }>(who.id, who.email, '/musica/dj/presets', {
			method: 'POST',
			body: JSON.stringify(preset)
		})
	).id;

export const deleteDjPreset = (who: Who, id: number) =>
	askHouse(who.id, who.email, `/musica/dj/presets/${id}`, { method: 'DELETE' });

/** Modo DJ's two requests, as the house's browsers make them: passed on as they come. */
export const djSongs = (who: Who, body: unknown) =>
	askHouse<MusicTrack[]>(who.id, who.email, '/musica/dj/aleatorio', {
		method: 'POST',
		body: JSON.stringify(body)
	});

/** The DJ's words take a while: the AI writes them and a voice reads them. */
const DJ_WORDS_MS = 60_000;

export const djWords = (who: Who, body: unknown) =>
	askHouse<MusicTrack>(
		who.id,
		who.email,
		'/musica/dj/locutor',
		{ method: 'POST', body: JSON.stringify(body) },
		DJ_WORDS_MS
	);
