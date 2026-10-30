import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { createPlaylist, listPlaylists } from '#lib/server/music/playlists.ts';

/** The music API (#253): the house's playlists, newest first, with how much each has. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudViewer(request);
	return json({ playlists: await listPlaylists() });
};

/** A new one, from the cloud's Música: `{ name }`; its id back. */
export const POST: RequestHandler = async ({ request }) => {
	await cloudViewer(request);
	const name = String((await request.json().catch(() => null))?.name ?? '').trim();
	if (!name) error(400, 'Escribe un nombre');
	return json({ id: await createPlaylist(name.slice(0, 100)) });
};
