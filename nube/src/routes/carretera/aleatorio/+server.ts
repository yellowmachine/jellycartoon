import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { randomTracks } from '#lib/server/music.ts';

/** «Todo aleatorio»: tracks from all the music, in random order, to play from the road mode (as jellycartoon's). */
export const GET: RequestHandler = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	try {
		return json(await randomTracks(who));
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
