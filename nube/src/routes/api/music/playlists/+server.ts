import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { changePlaylist, createPlaylist } from '#lib/server/music.ts';

/**
 * From the «+» of any track (comun's AddToPlaylist), as at home: into one of the house's
 * playlists, or into a new one (`name`).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const { trackId, playlistId, name } = await request.json().catch(() => ({}));
	if (!Number.isInteger(trackId)) error(400, 'Canción no válida');
	try {
		if (typeof name === 'string') {
			if (!name.trim()) error(400, 'Escribe un nombre');
			const id = await createPlaylist(who, name.trim().slice(0, 100));
			await changePlaylist(who, id, { action: 'add', trackId });
			return json({ playlistId: id });
		}
		if (!Number.isInteger(playlistId)) error(400, 'Lista no válida');
		await changePlaylist(who, playlistId, { action: 'add', trackId });
		return json({ playlistId });
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
