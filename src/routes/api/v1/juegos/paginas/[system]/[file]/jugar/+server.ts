import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { playerPage } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** What the player needs, with the person's buttons for its console. */
export const GET: RequestHandler = async ({ params, request }) => {
	const person = await cloudPerson(request);
	return json(await playerPage(params, person.id));
};
