import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findGame, SYSTEMS } from '#lib/server/games.ts';

export const load: PageServerLoad = async ({ params }) => {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	return {
		title: game.title,
		core: SYSTEMS[game.system].core,
		rom: `/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.file)}`
	};
};
