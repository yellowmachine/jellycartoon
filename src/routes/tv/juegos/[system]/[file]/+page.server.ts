import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { foundGame, gamePage } from '#lib/server/game-pages.ts';
import { chooseGame, chooseGameBackdrop, PICTURES, type Picture } from '#lib/server/games.ts';
import { log } from '#lib/server/log.ts';
import { openInRetrodeck, retrodeckEnabled } from '#lib/server/retrodeck.ts';

/** A game's page (#176): what it is, its background and «Jugar». */
export const load: PageServerLoad = ({ params, locals }) => gamePage(params, locals.user!.id);

export const actions: Actions = {
	/** In RetroDECK on the PC with the screen, instead of in the browser: it comes over this page. */
	retrodeck: async ({ params }) => {
		const { game } = await foundGame(params);
		if (!(await retrodeckEnabled()))
			return fail(503, { message: 'Sin el servicio de RetroDECK (RETRODECK_SOCKET)' });
		try {
			await openInRetrodeck(game.system, game.file);
		} catch (problem) {
			log.warn('juegos', 'No se pudo abrir el juego en RetroDECK', {
				system: game.system,
				file: game.file,
				error: problem
			});
			return fail(503, {
				message: 'El PC del salón no abre RetroDECK: ¿está su servicio? (scripts/pantalla.sh)'
			});
		}
		log.info('juegos', 'Juego abierto en RetroDECK', { system: game.system, file: game.file });
		return { opened: `Abriendo «${game.title}» en RetroDECK…` };
	},
	/** One of its pictures as its background. */
	backdrop: async ({ params, request }) => {
		const { row } = await foundGame(params);
		const kind = (await request.formData()).get('kind') as Picture;
		if (!PICTURES.includes(kind) || !(await chooseGameBackdrop(row.id, kind)))
			return fail(400, { message: 'Esa imagen no está' });
	},
	/** One of the candidates, when it was not clear which game it is. */
	choose: async ({ params, request }) => {
		const { row } = await foundGame(params);
		const id = (await request.formData()).get('wikidataId');
		if (!row.candidates.some((c) => c.id === id)) return fail(400, { message: 'No es una opción' });
		try {
			await chooseGame(row.id, id as string);
		} catch (problem) {
			log.warn('juegos', 'No se pudo guardar la ficha de un juego', {
				gameId: row.id,
				error: problem
			});
			return fail(503, { message: 'No se pudo leer de Wikidata; prueba otra vez' });
		}
	}
};
