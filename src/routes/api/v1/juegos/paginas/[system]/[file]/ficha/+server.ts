import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gameDetails } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** What the game is, and its background: looked up the first time, which may take a while. */
export const GET: RequestHandler = async ({ params, request }) => {
	await cloudPerson(request);
	const { backdrop, info } = await gameDetails(params);
	return json({ backdrop: await backdrop, info: await info });
};
