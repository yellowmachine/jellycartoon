import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { controlsOf } from '#lib/server/game-controls.ts';
import { shaderFor } from '#lib/server/game-shaders.ts';
import { findGame, gameRow, SYSTEMS } from '#lib/server/games.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	const row = await gameRow(game.system, game.file);
	return {
		title: game.title,
		core: SYSTEMS[game.system].core,
		rom: `/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.file)}`,
		/** The BIOS it needs (Neo Geo's), from the same folder. */
		bios:
			game.bios &&
			`/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.bios)}`,
		/** Its row, for the saved games of its menu. */
		gameId: row.id,
		/** Where a capture of the game goes, as the background of its page. */
		backdrop: `/api/fondo/juego/${row.id}`,
		/** The person's cartridge save of it, on the server. */
		cartridge: `/api/juegos/cartucho/${row.id}`,
		/** The person's buttons for its console. */
		controls: await controlsOf(locals.user!.id, game.system),
		/** The house's shader for it (/juegos/shaders): its own, and the one it has without it. */
		shader: await shaderFor(game.system, row.id)
	};
};
