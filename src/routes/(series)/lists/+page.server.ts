import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createList,
	generateList,
	getActiveList,
	getLists,
	setActiveList
} from '#lib/server/lists.ts';
import { getTags } from '#lib/server/tags.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const [lists, active, tags] = await Promise.all([
		getLists(locals.user!.id),
		getActiveList(locals.user!.id),
		getTags()
	]);
	return { lists, activeId: active?.id ?? null, tags };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Ponle un nombre a la lista' });
		await createList(locals.user!.id, name);
	},
	/** About `minutes` of episodes from the series the tags allow, into a new list. */
	generate: async ({ request, locals }) => {
		const form = await request.formData();
		const minutes = Number(form.get('minutes'));
		const include = form.getAll('include').map(Number);
		const exclude = form.getAll('exclude').map(Number);
		if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600)
			return fail(400, { generate: true, message: 'Duración no válida' });
		if (![...include, ...exclude].every(Number.isInteger))
			return fail(400, { generate: true, message: 'Etiqueta no válida' });
		const name = String(form.get('name') ?? '').trim() || `${minutes} minutos`;
		const id = await generateList(locals.user!.id, name, minutes, { include, exclude });
		if (id === null)
			return fail(400, {
				generate: true,
				message: 'No hay capítulos convertidos en las series que eliges'
			});
		redirect(303, `/lists/${id}`);
	},
	activate: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Lista no válida' });
		await setActiveList(locals.user!.id, id);
	}
};
