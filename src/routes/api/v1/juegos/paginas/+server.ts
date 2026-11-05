import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consoleCards } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** The games' pages, for Seilide (#405): the consoles. Only adults, as at home. */
export const GET: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	return json(await consoleCards());
};
