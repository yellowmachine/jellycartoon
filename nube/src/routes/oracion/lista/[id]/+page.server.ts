import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prayerKitchen } from '#lib/server/prayer-pages.ts';
import {
	deleteList,
	listLists,
	listPrayers,
	parseListInput,
	saveList
} from '#lib/server/prayers.ts';

/** A list of Oración (#339): new (`nueva`) or one of the family's, with the texts to choose from. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await prayerKitchen(locals);
	const prayers = (await listPrayers(k)).map(({ id, title, audioUrl }) => ({
		id,
		title,
		hasVoice: Boolean(audioUrl)
	}));
	if (params.id === 'nueva') return { prayers, list: null };
	const list = (await listLists(k)).find((l) => l.id === Number(params.id));
	if (!list) error(404, 'Esa lista ya no está');
	return { prayers, list };
};

const idOf = (params: { id: string }) => (params.id === 'nueva' ? null : Number(params.id));

export const actions: Actions = {
	/** `list` as JSON, as the page has it. */
	save: async ({ request, locals, params }) => {
		let body: unknown;
		try {
			body = JSON.parse(String((await request.formData()).get('list') ?? ''));
		} catch {
			return fail(400, { problem: 'No válida' });
		}
		const input = parseListInput(body);
		if (!input) return fail(400, { problem: 'Falta el título' });
		const id = await saveList(await prayerKitchen(locals), idOf(params), input);
		if (!id) return fail(404, { problem: 'Esa lista, o uno de sus textos, ya no está' });
		redirect(303, '/oracion');
	},
	delete: async ({ locals, params }) => {
		const id = idOf(params);
		if (id) await deleteList(await prayerKitchen(locals), id);
		redirect(303, '/oracion');
	}
};
