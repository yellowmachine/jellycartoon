import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	saveSteamGames,
	steamGames,
	steamLaunchEnabled,
	steamPictureUrl
} from '#lib/server/steam.ts';

/** Steam's installed games, each with its cover: choosing one opens it in Big Picture. */
export const load: PageServerLoad = async () => {
	const games = await steamGames();
	if (!games.length) error(404, 'No hay juegos de Steam (STEAM_DIR)');
	await saveSteamGames(games);
	return {
		games: games.map((g) => ({
			appid: g.appid,
			name: g.name,
			cover: steamPictureUrl(g.appid, 'caratula')
		})),
		canLaunch: steamLaunchEnabled
	};
};
