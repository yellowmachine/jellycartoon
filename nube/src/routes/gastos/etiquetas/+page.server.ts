import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	deleteTag,
	lineTexts,
	ownTags,
	renameTag,
	tagLines,
	type TagChoice
} from '#lib/server/expenses/own-tags.ts';

/**
 * Dinero → Etiquetas (#459): the family's own tags, renamed or deleted, and every text of its
 * receipts' lines, to give many a tag at once.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [own, texts] = await Promise.all([ownTags(k), lineTexts(k)]);
	return { own, texts };
};

const kitchen = (locals: App.Locals) => kitchenOf(locals.user!.id);

export const actions: Actions = {
	/** The `text`s ticked: `tag` a tag's id, `nueva` with `name`, or empty for none. */
	tag: async ({ request, locals }) => {
		const form = await request.formData();
		const tag = String(form.get('tag') ?? '');
		const choice: TagChoice =
			tag === 'nueva'
				? { name: String(form.get('name') ?? '') }
				: tag
					? { tagId: Number(tag) }
					: null;
		if (choice && 'tagId' in choice && !Number.isInteger(choice.tagId))
			return fail(400, { message: 'Etiqueta no válida' });
		const texts = form.getAll('text').map(String);
		if (!texts.length) return fail(400, { message: 'No hay nada marcado' });
		if (!(await tagLines(await kitchen(locals), texts, choice)))
			return fail(400, {
				message: tag === 'nueva' ? 'Escribe el nombre de la etiqueta' : 'Esa etiqueta ya no está'
			});
		return { tagged: texts.length };
	},
	rename: async ({ request, locals }) => {
		const form = await request.formData();
		if (
			!(await renameTag(
				await kitchen(locals),
				Number(form.get('id')),
				String(form.get('name') ?? '')
			))
		)
			return fail(400, { message: 'Escribe el nombre nuevo' });
	},
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await deleteTag(await kitchen(locals), id);
	}
};
