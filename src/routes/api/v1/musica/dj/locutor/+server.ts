import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { djWords } from '#lib/server/music/dj-requests.ts';

/**
 * The music API (#253): Modo DJ in the cloud's browsers, what the DJ says (dj-requests.ts). Its
 * audio, by the pass: `<base>/locutor/<clip id>`.
 */
export const POST: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json(await djWords(await request.json().catch(() => null)));
};
