import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prayerKitchen } from '#lib/server/prayer-pages.ts';
import { deleteVoice, listVoices, parseVoiceInput, saveVoice } from '#lib/server/prayers.ts';

/** The family's voices for Oración (#339): one of Gemini's and how it reads, with a name. */
export const load: PageServerLoad = async ({ locals }) => ({
	voices: await listVoices(await prayerKitchen(locals))
});

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const input = parseVoiceInput(form);
		if (!input) return fail(400, { problem: 'Falta el nombre o la voz', id: form.get('id') });
		const id = await saveVoice(await prayerKitchen(locals), Number(form.get('id')) || null, input);
		if (!id) return fail(404, { problem: 'Esa voz ya no está', id: form.get('id') });
		return { saved: id };
	},
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!(await deleteVoice(await prayerKitchen(locals), id)))
			return fail(400, { problem: 'La usa algún texto: cámbiale la voz antes', id: String(id) });
	}
};
