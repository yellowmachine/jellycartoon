import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { deleteNote, noteArticle } from '#lib/server/notes.ts';
import { safeArticleHtml } from '#lib/server/notes-reader.ts';

/**
 * «Leer» (#634): a web saved in Notas, its article as it was cleaned when saved, only to read. One's
 * own, or shared with the house; `?sin=1`, just saved and not readable.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'No encontrada');
	const found = await noteArticle(await kitchenOf(locals.user!.id), locals.user!.id, id);
	if (!found) error(404, 'No encontrada');
	const article = found.article && {
		...found.article,
		html: safeArticleHtml(found.article.html),
		text: ''
	};
	return { note: found.note, article, justSaved: url.searchParams.has('sin') };
};

export const actions: Actions = {
	/** Read, it goes: «Para leer» keeps no «leído». */
	delete: async ({ params, locals }) => {
		await deleteNote(await kitchenOf(locals.user!.id), locals.user!.id, Number(params.id));
		redirect(303, '/notas?leer');
	}
};
