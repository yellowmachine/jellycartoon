import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { albumTracks } from '#lib/server/music.ts';

/** An album's tracks, from the house, for the road mode. */
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		return json({
			tracks: await albumTracks(
				{ id: locals.user!.id, email: locals.user!.email },
				Number(params.id)
			)
		});
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
