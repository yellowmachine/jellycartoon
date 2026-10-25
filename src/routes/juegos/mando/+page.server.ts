import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { consoleButtons, isControls } from '#lib/game-controls.ts';
import { controlsOf, resetControls, saveControls } from '#lib/server/game-controls.ts';
import { allGames, SYSTEMS } from '#lib/server/games.ts';
import { gamesRoot } from '#lib/server/library/paths.ts';

/** The person's buttons for one console (#176), `?consola=`, or the first with games. */
export const load: PageServerLoad = async ({ url, locals }) => {
	if (!gamesRoot) error(404, 'No hay carpeta de juegos (GAMES_DIR)');
	const systems = (await allGames()).map((s) => ({ id: s.id, name: s.name }));
	const system = url.searchParams.get('consola') ?? systems[0]?.id;
	if (!system || !SYSTEMS[system]) return { systems, system: null };
	return {
		systems,
		system,
		name: SYSTEMS[system].name,
		buttons: consoleButtons(SYSTEMS[system].core),
		controls: await controlsOf(locals.user!.id, system)
	};
};

function systemOf(form: FormData) {
	const system = String(form.get('system'));
	if (!SYSTEMS[system]) error(404, 'Consola desconocida');
	return system;
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const system = systemOf(form);
		let controls: unknown;
		try {
			controls = JSON.parse(String(form.get('controls')));
		} catch {
			controls = null;
		}
		if (!isControls(SYSTEMS[system].core, controls))
			return fail(400, { message: 'Botones incompletos o repetidos' });
		await saveControls(locals.user!.id, system, controls);
	},
	reset: async ({ request, locals }) => {
		await resetControls(locals.user!.id, systemOf(await request.formData()));
	}
};
