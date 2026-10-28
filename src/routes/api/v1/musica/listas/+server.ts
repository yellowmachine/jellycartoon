import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { listPlaylists } from '#lib/server/music/playlists.ts';

/** The music API (#253): the house's playlists, newest first, with how much each has. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json({ playlists: await listPlaylists() });
};
