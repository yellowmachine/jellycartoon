import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createList, getActiveList, getLists, setActiveList } from '#lib/server/lists.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const [lists, active] = await Promise.all([
		getLists(locals.user!.id),
		getActiveList(locals.user!.id)
	]);
	return { lists, activeId: active?.id ?? null };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Ponle un nombre a la lista' });
		await createList(locals.user!.id, name);
	},
	activate: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Lista no válida' });
		await setActiveList(locals.user!.id, id);
	}
};
