import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { gamePlayer } from '#lib/server/games.ts';
import { HouseProblem } from '#lib/server/house.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		return await gamePlayer(locals.user!, params.system, params.file);
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
