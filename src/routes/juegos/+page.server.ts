import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { playStats } from '#lib/server/game-sessions.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

/** The person's play statistics (#176), in the whole app: the games are played in the TV view. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	return { stats: await playStats(locals.user!.id) };
};
