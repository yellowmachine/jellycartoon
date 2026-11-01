import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import {
	addManyToPlaylist,
	createPlaylist,
	listPlaylists,
	trackIdsOf
} from '#lib/server/music/playlists.ts';

/** The music API (#253): the house's playlists, newest first, with how much each has. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudViewer(request);
	return json({ playlists: await listPlaylists() });
};

/**
 * A new one, from the cloud's Música: `{ name, trackIds? }`, with those songs in that order (the
 * queue saved as a list). Back, its id and how many went in (a house from before says none).
 */
export const POST: RequestHandler = async ({ request }) => {
	await cloudViewer(request);
	const body = await request.json().catch(() => null);
	const name = String(body?.name ?? '').trim();
	if (!name) error(400, 'Escribe un nombre');
	const ids = body?.trackIds === undefined ? [] : trackIdsOf(body.trackIds);
	if (!ids) error(400, 'Canción no válida');
	const id = await createPlaylist(name.slice(0, 100));
	await addManyToPlaylist(id, ids);
	return json({ id, added: ids.length });
};
