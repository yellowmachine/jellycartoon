import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addManyToPlaylist,
	addToPlaylist,
	createPlaylist,
	trackIdsOf
} from '#lib/server/music/playlists.ts';

/**
 * From the «+» of any track: into a playlist, or into a new one (`name`). For the pages that list
 * tracks, which are not the playlists' own. With `trackIds` instead of `trackId`, several in that
 * order: the queue saved as a list.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { trackId, trackIds, playlistId, name } = await request.json();
	const ids =
		trackIds === undefined ? (Number.isInteger(trackId) ? [trackId] : null) : trackIdsOf(trackIds);
	if (!ids?.length) error(400, 'Canción no válida');
	if (typeof name === 'string') {
		const trimmed = name.trim();
		if (!trimmed) error(400, 'Escribe un nombre');
		const id = await createPlaylist(trimmed.slice(0, 100));
		await addManyToPlaylist(id, ids);
		return json({ playlistId: id });
	}
	if (!Number.isInteger(playlistId)) error(400, 'Lista no válida');
	await (
		ids.length === 1 ? addToPlaylist(playlistId, ids[0]!) : addManyToPlaylist(playlistId, ids)
	).catch(() => error(404, 'Esa lista ya no existe'));
	return json({ playlistId });
};
