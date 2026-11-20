import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { consoleCovers, consoleGames } from '#lib/server/games.ts';
import { playsOwnGames } from '#lib/server/game-source.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { ownConsoleGames, ownCovers } from '#lib/server/own-games.ts';

const noCovers = (): Record<string, string> => ({});

export const load: PageServerLoad = async ({ params, locals }) => {
	const who = locals.user!;
	// The family's bucket (#564): its boxes, asked libretro for while the page is already shown.
	if (await playsOwnGames(who.id)) {
		const { familyId } = await kitchenOf(who.id);
		return {
			...(await ownConsoleGames(familyId, params.system)),
			covers: ownCovers(familyId, params.system).catch(noCovers)
		};
	}
	try {
		return {
			...(await consoleGames(who, params.system)),
			// Without their boxes, the games all the same: while the page is already shown.
			covers: consoleCovers(who, params.system).catch(noCovers)
		};
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
