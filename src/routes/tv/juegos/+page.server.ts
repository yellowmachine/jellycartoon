import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allGames, systemCovers } from '#lib/server/games.ts';
import { gamesRoot, steamRoot } from '#lib/server/library/paths.ts';
import { steamGames, steamPictureUrl } from '#lib/server/steam.ts';

/** Tiles in each console's mosaic: 3 × 2, as in the TV view's cards. */
const MOSAIC = 6;

/** One card per console with games, and Steam's last; their games are on their own page. */
export const load: PageServerLoad = async () => {
	if (!gamesRoot && !steamRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR ni STEAM_DIR)');
	const [systems, steam] = await Promise.all([gamesRoot ? allGames() : [], steamGames()]);
	const consoles = await Promise.all(
		systems.map(async (s) => ({
			id: s.id,
			name: s.name,
			count: s.games.length,
			// Its games' boxes, those already fetched (when its games were shown).
			images: Object.values(await systemCovers(s.id, s.games, false)).slice(0, MOSAIC)
		}))
	);
	return {
		systems: steam.length
			? [
					...consoles,
					{
						id: 'steam',
						name: 'Steam',
						count: steam.length,
						images: steam.slice(0, MOSAIC).map((g) => steamPictureUrl(g.appid, 'caratula'))
					}
				]
			: consoles
	};
};
