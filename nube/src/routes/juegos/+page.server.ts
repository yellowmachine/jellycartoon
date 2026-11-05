import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { gameConsoles } from '#lib/server/games.ts';
import { HouseProblem } from '#lib/server/house.ts';

/** The house's consoles (#405). Its games are played in this browser. */
export const load: PageServerLoad = async ({ locals }) => {
	try {
		return { systems: await gameConsoles(locals.user!), problem: null };
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		if (err.status === null) return { systems: [], problem: err.message };
		error(err.status === 404 ? 404 : 502, err.message);
	}
};
