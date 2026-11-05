import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { consoleCards } from '#lib/server/game-pages.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

/** The consoles, to play in this browser (#405). Steam and RetroDECK open on the salon's PC. */
export const load: PageServerLoad = async () => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	return { systems: await consoleCards() };
};
