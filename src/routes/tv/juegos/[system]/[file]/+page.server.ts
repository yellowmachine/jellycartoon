import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	chooseGame,
	findGame,
	gameBackdropUrl,
	gameRow,
	lookUpGame,
	SYSTEMS,
	type GameRow
} from '#lib/server/games.ts';
import { log } from '#lib/server/log.ts';

/** Only what the page shows. */
const card = (row: GameRow) => ({
	status: row.status,
	year: row.year,
	developers: row.developers,
	publishers: row.publishers,
	genres: row.genres,
	modes: row.modes,
	composers: row.composers,
	synopsis: row.synopsis,
	candidates: row.candidates
});

async function found(params: { system: string; file: string }) {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	return { game, row: await gameRow(game.system, game.file) };
}

/** A game's page (#176): what it is, its background and «Jugar». */
export const load: PageServerLoad = async ({ params }) => {
	const { game, row } = await found(params);
	return {
		title: game.title,
		system: SYSTEMS[game.system].name,
		backdrop: await gameBackdropUrl(row.id),
		// Looked up the first time, while the page is already shown.
		info: row.status
			? card(row)
			: lookUpGame(row).then(card, (problem) => {
					log.warn('juegos', `No se pudo buscar la ficha de «${game.title}»`, {
						gameId: row.id,
						error: problem
					});
					return null;
				})
	};
};

export const actions: Actions = {
	/** One of the candidates, when it was not clear which game it is. */
	choose: async ({ params, request }) => {
		const { row } = await found(params);
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
