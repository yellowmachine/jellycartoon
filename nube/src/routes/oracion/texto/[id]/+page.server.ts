import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { prayerKitchen } from '#lib/server/prayer-pages.ts';
import {
	deletePrayer,
	generatePrayer,
	listPrayers,
	listVoices,
	parsePrayerInput,
	savePrayer
} from '#lib/server/prayers.ts';

/** A text of Oración (#339): new (`nuevo`) or one of the family's, with its voice. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await prayerKitchen(locals);
	const voices = await listVoices(k);
	if (params.id === 'nuevo') return { voices, prayer: null };
	const prayer = (await listPrayers(k)).find((p) => p.id === Number(params.id));
	if (!prayer) error(404, 'Ese texto ya no está');
	return { voices, prayer };
};

const idOf = (params: { id: string }) => (params.id === 'nuevo' ? null : Number(params.id));

export const actions: Actions = {
	/** Saved; with `generate`, its voice made too. A new one, then at its own address. */
	save: async ({ request, locals, params }) => {
		const k = await prayerKitchen(locals);
		const form = await request.formData();
		const input = parsePrayerInput(form);
		if (!input) return fail(400, { problem: 'Falta el título, el texto o la voz' });
		const id = await savePrayer(k, idOf(params), input);
		if (!id) return fail(404, { problem: 'Ese texto o su voz ya no están' });
		if (form.get('generate')) {
			const why = await generatePrayer(k, id, await openRouterKey(k));
			if (why) return fail(400, { problem: why });
		}
		if (!idOf(params)) redirect(303, `/oracion/texto/${id}`);
		return { saved: true };
	},
	generate: async ({ locals, params }) => {
		const id = idOf(params);
		if (!id) return fail(400, { problem: 'Guárdalo primero' });
		const k = await prayerKitchen(locals);
		const why = await generatePrayer(k, id, await openRouterKey(k));
		if (why) return fail(400, { problem: why });
	},
	delete: async ({ locals, params }) => {
		const id = idOf(params);
		if (id) await deletePrayer(await prayerKitchen(locals), id);
		redirect(303, '/oracion');
	}
};
