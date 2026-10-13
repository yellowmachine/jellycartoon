import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addToPlaylist, createPlaylist } from '#lib/server/music/playlists.ts';

/**
 * From the «+» of any track: into a playlist, or into a new one (`name`). For the pages that list
 * tracks, which are not the playlists' own.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { trackId, playlistId, name } = await request.json();
	if (!Number.isInteger(trackId)) error(400, 'Canción no válida');
	if (typeof name === 'string') {
		const trimmed = name.trim();
		if (!trimmed) error(400, 'Escribe un nombre');
		const id = await createPlaylist(trimmed.slice(0, 100));
		await addToPlaylist(id, trackId);
		return json({ playlistId: id });
	}
	if (!Number.isInteger(playlistId)) error(400, 'Lista no válida');
	await addToPlaylist(playlistId, trackId).catch(() => error(404, 'Esa lista ya no existe'));
	return json({ playlistId });
};
