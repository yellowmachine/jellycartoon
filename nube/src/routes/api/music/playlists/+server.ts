import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { changePlaylist, createPlaylist } from '#lib/server/music.ts';

/** At most this many at once, as the house takes them. */
const MAX_TRACKS = 2000;

/**
 * From the «+» of any track (comun's AddToPlaylist), as at home: into one of the house's
 * playlists, or into a new one (`name`). With `trackIds` and a `name`, a new one with all of them
 * in that order: the queue saved as a list (comun's MusicBar).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const { trackId, trackIds, playlistId, name } = await request.json().catch(() => ({}));
	const many =
		Array.isArray(trackIds) &&
		trackIds.length > 0 &&
		trackIds.length <= MAX_TRACKS &&
		trackIds.every((id: unknown) => Number.isInteger(id) && (id as number) > 0);
	if (!many && !Number.isInteger(trackId)) error(400, 'Canción no válida');
	try {
		if (typeof name === 'string') {
			if (!name.trim()) error(400, 'Escribe un nombre');
			const id = await createPlaylist(who, name.trim().slice(0, 100), many ? trackIds : [trackId]);
			return json({ playlistId: id });
		}
		if (many || !Number.isInteger(playlistId)) error(400, 'Lista no válida');
		await changePlaylist(who, playlistId, { action: 'add', trackId });
		return json({ playlistId });
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
