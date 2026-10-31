import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { houseNow } from '#lib/server/prayer-pages.ts';

/**
 * What the whole house plays of Oración (#339), for its page, asked every few seconds while it is
 * open: `now`, or null; `problem`, the house did not answer.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json({ now: await houseNow(locals), problem: null });
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		return json({ now: null, problem: err.message });
	}
};
