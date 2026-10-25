import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findGame, gameRow, SYSTEMS } from '#lib/server/games.ts';

export const load: PageServerLoad = async ({ params }) => {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	const row = await gameRow(game.system, game.file);
	return {
		title: game.title,
		core: SYSTEMS[game.system].core,
		rom: `/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.file)}`,
		/** Where a capture of the game goes, as the background of its page. */
		backdrop: `/api/fondo/juego/${row.id}`
	};
};
