import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { consoleCovers, consoleGames } from '#lib/server/games.ts';
import { HouseProblem } from '#lib/server/house.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const who = locals.user!;
	try {
		return {
			...(await consoleGames(who, params.system)),
			// Without their boxes, the games all the same: while the page is already shown.
			covers: consoleCovers(who, params.system).catch((): Record<string, string> => ({}))
		};
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
