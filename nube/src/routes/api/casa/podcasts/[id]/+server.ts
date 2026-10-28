import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { podcastPage } from '#lib/server/podcasts/podcasts.ts';
import { personOnly } from '../person.ts';

/** One podcast and its episodes, with where the person asking is in each (the house's TV). */
export const GET: RequestHandler = async ({ request, params }) => {
	const podcast = await podcastPage(personOnly(await houseRequest(request)), Number(params.id));
	if (!podcast) error(404, 'Podcast no encontrado');
	return json({ podcast });
};
