import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allGames, SYSTEMS, systemBackdrops } from '#lib/server/games.ts';

/** A console's games, with the capture of each one that has it. */
export const load: PageServerLoad = async ({ params }) => {
	const system = (await allGames()).find((s) => s.id === params.system);
	if (!system) error(404, 'No hay juegos de esa consola');
	const backdrops = await systemBackdrops(system.id);
	return {
		name: SYSTEMS[system.id].name,
		games: system.games.map((g) => ({
			file: g.file,
			title: g.title,
			image: backdrops.get(g.file) ?? null
		}))
	};
};
