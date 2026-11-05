import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { consoleCards } from '#lib/server/game-pages.ts';
import { gamesRoot, steamRoot } from '#lib/server/library/paths.ts';
import { retrodeckEnabled } from '#lib/server/retrodeck.ts';
import { steamGames, steamPictureUrl } from '#lib/server/steam.ts';

/**
 * One card per console with games, and Steam's last; their games are on their own page. Then
 * RetroDECK's, which opens it on the PC with the screen.
 */
export const load: PageServerLoad = async () => {
	if (!gamesRoot && !steamRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR ni STEAM_DIR)');
	const [consoles, steam] = await Promise.all([gamesRoot ? consoleCards() : [], steamGames()]);
	return {
		retrodeck: await retrodeckEnabled(),
		systems: steam.length
			? [
					...consoles,
					{
						id: 'steam',
						name: 'Steam',
						count: steam.length,
						images: steam.slice(0, 6).map((g) => steamPictureUrl(g.appid, 'caratula'))
					}
				]
			: consoles
	};
};
