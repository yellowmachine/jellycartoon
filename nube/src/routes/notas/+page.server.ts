import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	addWrittenNote,
	deleteNote,
	editNote,
	hearAgain,
	listNotes,
	NotAPhoto,
	shareNote
} from '#lib/server/notes.ts';
import { refused } from '#lib/server/storage.ts';
import { MAX_NOTE_PHOTO_BYTES } from '#lib/notes.ts';

/**
 * Notas (#416): one's own and those of the whole house, the latest first; `?q=`, searched; `?casa`, only
 * the house's.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() || null;
	const house = url.searchParams.has('casa');
	const k = await kitchenOf(locals.user!.id);
	return { notes: await listNotes(k, locals.user!.id, q, { house }), q, house };
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) ? id : null;
};

export const actions: Actions = {
	write: async ({ request, locals }) => {
		const form = await request.formData();
		const file = form.get('photo');
		const photo = file instanceof File && file.size ? file : null;
		if (photo && photo.size > MAX_NOTE_PHOTO_BYTES)
			return fail(413, { message: 'La foto es demasiado grande' });
		const k = await kitchenOf(locals.user!.id);
		try {
			const id = await addWrittenNote(k, locals.user!.id, {
				text: String(form.get('text') ?? ''),
				photo: photo && new Uint8Array(await photo.arrayBuffer()),
				shared: form.has('shared')
			});
			if (!id) return fail(400, { message: 'Una nota necesita algo escrito o una foto' });
		} catch (err) {
			if (err instanceof NotAPhoto) return fail(415, { message: err.message });
			const no = refused(err);
			if (no) return fail(no.status, { message: no.message });
			throw err;
		}
	},
	edit: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const text = String(form.get('text') ?? '').trim();
		if (!id || !text) return fail(400, { message: 'Una nota necesita algo escrito' });
		const k = await kitchenOf(locals.user!.id);
		if (!(await editNote(k, locals.user!.id, id, text)))
			return fail(404, { message: 'Esa nota ya no está' });
	},
	/** Shown to the whole house (`shared`), or only to its person again. */
	share: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const k = await kitchenOf(locals.user!.id);
		if (!id || !(await shareNote(k, locals.user!.id, id, form.get('shared') === '1')))
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
