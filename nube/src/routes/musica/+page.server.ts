import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { catalog, deleteDjPreset, djInfo, saveDjPreset } from '#lib/server/music.ts';
import { parseDjOptions } from 'comun/music.ts';

/** A saved setup's name: short enough for the menu. */
const PRESET_NAME_MAX = 60;

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/**
 * Música's albums and artists (#253), as jellycartoon's: the house's catalog, searched in the
 * browser; and its Modo DJ, with this person's saved setups. The catalog, all of it, takes a
 * while: not awaited, the page opens meanwhile and it comes after
 * (https://svelte.dev/docs/kit/load#Streaming-with-promises).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const who = whoOf(locals);
	// Without the house, nothing.
	const albums = catalog(who).catch((error) => {
		if (!(error instanceof HouseProblem)) throw error;
		return [];
	});
	const dj = await djInfo(who);
	return { albums, dj: dj.enabled, djVoices: dj.voices, djPresets: dj.presets };
};

export const actions: Actions = {
	/** A Modo DJ setup saved with a name, at home: new, or `id` changed. */
	djSave: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name || name.length > PRESET_NAME_MAX)
			return fail(400, { message: `Ponle un nombre (hasta ${PRESET_NAME_MAX} letras)` });
		let options = null;
		try {
			options = parseDjOptions(JSON.parse(String(form.get('options'))));
		} catch {
			// Stays null.
		}
		if (!options) return fail(400, { message: 'Configuración no válida' });
		const id = Number(form.get('id')) || null;
		try {
			return { saved: await saveDjPreset(whoOf(locals), { id, name, options }) };
		} catch (error) {
			if (!(error instanceof HouseProblem)) throw error;
			return fail(400, { message: error.message });
		}
	},
	djDelete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (id) await deleteDjPreset(whoOf(locals), id).catch(() => {});
	}
};
