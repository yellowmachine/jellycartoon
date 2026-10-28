import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { moreSongs } from '#lib/server/music/dj-requests.ts';

/** The music API (#253): Modo DJ in the cloud's browsers, more songs at random (dj-requests.ts). */
export const POST: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json(await moreSongs(await request.json().catch(() => null)));
};
