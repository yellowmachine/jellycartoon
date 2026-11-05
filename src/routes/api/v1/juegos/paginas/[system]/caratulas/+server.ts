import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consolePage } from '#lib/server/game-pages.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** A console's boxes: those missing are fetched from libretro first. */
export const GET: RequestHandler = async ({ params, request }) => {
	await cloudPerson(request);
	return json(await (await consolePage(params.system)).covers);
};
