import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allGames, SYSTEMS, systemCovers } from '#lib/server/games.ts';
import { log } from '#lib/server/log.ts';

/** A console's games, each with its box. */
export const load: PageServerLoad = async ({ params }) => {
	const system = (await allGames()).find((s) => s.id === params.system);
	if (!system) error(404, 'No hay juegos de esa consola');
	return {
		name: SYSTEMS[system.id].name,
		games: system.games.map(({ file, title }) => ({ file, title })),
		// Those missing are fetched from libretro, while the page is already shown.
		covers: systemCovers(
			system.id,
			system.games.map((g) => g.file)
		).catch((problem): Record<string, string> => {
			log.warn('juegos', 'No se pudieron bajar las carátulas', {
				system: system.id,
				error: problem
			});
			return {};
		})
	};
};
