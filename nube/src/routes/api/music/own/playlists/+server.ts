import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { addToOwnPlaylist, createOwnPlaylist, MAX_TRACKS } from '#lib/server/own-music-lists.ts';

/**
 * The «+» of a song of «Tu música» (#534, phase 2), as the house's (api/music/playlists): into one
 * of its lists, or a new one (`name`); with `trackIds`, several in that order (a whole album).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const { trackId, trackIds, playlistId, name } = await request.json().catch(() => ({}));
	const many =
		Array.isArray(trackIds) &&
		trackIds.length > 0 &&
		trackIds.length <= MAX_TRACKS &&
		trackIds.every((id: unknown) => Number.isInteger(id) && (id as number) > 0);
	if (!many && !Number.isInteger(trackId)) error(400, 'Canción no válida');
	const ids: number[] = many ? trackIds : [trackId];
	if (typeof name === 'string') {
		if (!name.trim()) error(400, 'Escribe un nombre');
		return json({ playlistId: await createOwnPlaylist(familyId, name.trim(), ids) });
	}
	if (!Number.isInteger(playlistId)) error(400, 'Lista no válida');
	if (!(await addToOwnPlaylist(familyId, playlistId, ids))) error(404, 'Esa lista no está');
	return json({ playlistId });
};
