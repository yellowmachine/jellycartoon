import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { playlists } from '#lib/server/music.ts';

/** The house's playlists, to choose one before a walk (#416); without the house, none. */
export const GET: RequestHandler = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	try {
		return json((await playlists(who)).map(({ id, name }) => ({ id, name })));
	} catch (err) {
		if (err instanceof HouseProblem) return json([]);
		throw err;
	}
};
