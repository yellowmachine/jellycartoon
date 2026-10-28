import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

/**
 * The music API (#253): every album with its tracks, for the cloud's Música, which searches them
 * in the browser and groups them by artist, as the house's page does.
 */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json({ albums: await getAlbums() });
};
