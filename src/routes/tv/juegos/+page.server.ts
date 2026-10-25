import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allGames } from '#lib/server/games.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

export const load: PageServerLoad = async () => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	return { systems: await allGames() };
};
