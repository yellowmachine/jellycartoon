import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownDjTracks } from '#lib/server/own-music-dj.ts';

/**
 * Modo DJ with a list of «Tu música» (#534; comun's dj.svelte.ts): its next songs, mixed (not
 * those in `exclude`) or in order from `offset`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const body = await request.json().catch(() => null);
	const playlistId = body?.playlist?.id;
	if (!Number.isInteger(playlistId)) error(400, 'Lista no válida');
	const exclude = Array.isArray(body.exclude)
		? body.exclude.filter((id: unknown) => Number.isInteger(id)).slice(-1000)
		: [];
	const tracks = await ownDjTracks(familyId, playlistId, {
		inOrder: body.inOrder === true,
		offset: Number.isInteger(body.offset) && body.offset >= 0 ? body.offset : 0,
		exclude
	});
	if (!tracks) error(404, 'Esa lista no está');
	return json(tracks);
};
