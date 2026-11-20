import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { gamePlayer } from '#lib/server/games.ts';
import { playsOwnGames } from '#lib/server/game-source.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { ownPlayer } from '#lib/server/own-games.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	// The family's bucket (#564), with the rest asked for at Seilide's own (PlayerData.api).
	if (await playsOwnGames(locals.user!.id)) {
		const { familyId } = await kitchenOf(locals.user!.id);
		return ownPlayer(familyId, params.system, params.file);
	}
	try {
		return await gamePlayer(locals.user!, params.system, params.file);
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
