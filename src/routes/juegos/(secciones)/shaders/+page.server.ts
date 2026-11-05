import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { ALL, gameScope, isShader, systemScope } from '#lib/game-shaders.ts';
import { setShader, shaders } from '#lib/server/game-shaders.ts';
import { allGames, findGame, gameRow, SYSTEMS } from '#lib/server/games.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

/** The house's shaders (#176): for all the games, each console's and each game's. */
export const load: PageServerLoad = async () => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	const [systems, set, rows] = await Promise.all([
		allGames(),
		shaders(),
		db.select({ id: game.id, system: game.system, file: game.file }).from(game)
	]);
	const ids = new Map(rows.map((r) => [`${r.system}/${r.file}`, r.id]));
	const own = (system: string, file: string) => {
		const id = ids.get(`${system}/${file}`);
		return (id && set[gameScope(id)]) || null;
	};
	return {
		all: set[ALL] ?? null,
		systems: systems.map((s) => ({
			id: s.id,
			name: s.name,
			shader: set[systemScope(s.id)] ?? null,
			games: s.games.map((g) => ({ file: g.file, title: g.title, shader: own(s.id, g.file) }))
		}))
	};
};

export const actions: Actions = {
	/** One for all, a console or a game; empty, the one above. */
	set: async ({ request }) => {
		const form = await request.formData();
		const shader = String(form.get('shader') ?? '');
		if (shader && !isShader(shader)) return fail(400, { message: 'Ese shader no existe' });
		const system = String(form.get('system') ?? '');
		const file = String(form.get('file') ?? '');
		let scope = ALL;
		if (file) {
			const found = await findGame(system, file);
			if (!found) error(404, 'Juego no encontrado');
			scope = gameScope((await gameRow(found.system, found.file)).id);
		} else if (system) {
			if (!SYSTEMS[system]) error(404, 'Consola desconocida');
			scope = systemScope(system);
		}
		await setShader(scope, isShader(shader) ? shader : null);
	}
};
