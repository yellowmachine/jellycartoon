import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allGames, systemBackdrops } from '#lib/server/games.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

/** Tiles in each console's mosaic: 3 × 2, as in the TV view's cards. */
const MOSAIC = 6;

/** One card per console with games; its games are on its own page. */
export const load: PageServerLoad = async () => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	const systems = await allGames();
	return {
		systems: await Promise.all(
			systems.map(async (s) => ({
				id: s.id,
				name: s.name,
				count: s.games.length,
				// What its games look like: the captures taken while playing them.
				images: [...(await systemBackdrops(s.id)).values()].slice(0, MOSAIC)
			}))
		)
	};
};
