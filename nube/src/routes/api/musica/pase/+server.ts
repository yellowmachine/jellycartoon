import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicPass } from '#lib/server/music.ts';

/** A new pass, when the page's has expired (12 hours) or the house refused it. */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		return json(await musicPass({ id: locals.user!.id, email: locals.user!.email }));
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
