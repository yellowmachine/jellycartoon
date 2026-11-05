import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gameSummary } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** A game, and the person's saved games and play time. */
export const GET: RequestHandler = async ({ params, request }) => {
	const person = await cloudPerson(request);
	return json(await gameSummary(params, person.id));
};
