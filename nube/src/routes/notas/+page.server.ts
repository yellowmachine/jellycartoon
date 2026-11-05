import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { deleteNote, editNote, hearAgain, listNotes } from '#lib/server/notes.ts';

/** Notas (#416): one's own and those of the whole house, the latest first; `?q=`, searched. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() || null;
	return { notes: await listNotes(await kitchenOf(locals.user!.id), locals.user!.id, q), q };
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) ? id : null;
};

export const actions: Actions = {
	edit: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const text = String(form.get('text') ?? '').trim();
		if (!id || !text) return fail(400, { message: 'Una nota necesita algo escrito' });
		const k = await kitchenOf(locals.user!.id);
		if (!(await editNote(k, locals.user!.id, id, text)))
			return fail(404, { message: 'Esa nota ya no está' });
	},
	delete: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (id) await deleteNote(await kitchenOf(locals.user!.id), locals.user!.id, id);
	},
	/** One that could not be heard, again. */
	hear: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		const who = { id: locals.user!.id, email: locals.user!.email };
		if (!id || !(await hearAgain(await kitchenOf(who.id), who, id)))
			return fail(404, { message: 'Esa nota ya no está' });
	}
};
