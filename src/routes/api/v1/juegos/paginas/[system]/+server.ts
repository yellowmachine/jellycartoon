import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consolePage } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** A console's games; their boxes, in `caratulas`, which may take a while. */
export const GET: RequestHandler = async ({ params, request }) => {
	await cloudPerson(request);
	const { name, games, covers } = await consolePage(params.system);
	void covers;
	return json({ name, games });
};
