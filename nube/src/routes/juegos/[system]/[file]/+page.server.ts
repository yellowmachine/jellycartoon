import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { gameDetails, gameSummary } from '#lib/server/games.ts';
import { HouseProblem } from '#lib/server/house.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const who = locals.user!;
	try {
		const game = await gameSummary(who, params.system, params.file);
		// Looked up the first time, while the page is already shown.
		const details = gameDetails(who, params.system, params.file).catch(() => null);
		return {
			game,
			backdrop: details.then((d) => d?.backdrop ?? null),
			info: details.then((d) => d?.info ?? null)
		};
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
