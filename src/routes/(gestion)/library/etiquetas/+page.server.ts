import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deleteTag,
	getTagsWithItems,
	otherTagNamed,
	renameTag,
	tagName
} from '#lib/server/tags.ts';

export const load: PageServerLoad = async () => ({ tags: await getTagsWithItems() });

export const actions: Actions = {
	/** Merging with a tag of the same name only once it is confirmed (`merge`). */
	rename: async ({ request }) => {
		const form = await request.formData();
		const tagId = Number(form.get('tagId'));
		const name = tagName(String(form.get('name') ?? ''));
		if (!Number.isInteger(tagId)) return fail(400, { message: 'Etiqueta no válida' });
		if (!name) return fail(400, { tagId, message: 'Escribe un nombre' });
		if (name.length > 40) return fail(400, { tagId, message: 'Etiqueta demasiado larga' });
		const other = await otherTagNamed(tagId, name);
		if (other && !form.has('merge'))
			return fail(409, { tagId, merge: { name, series: other.series, films: other.films } });
		await renameTag(tagId, name);
	},
	delete: async ({ request }) => {
		const tagId = Number((await request.formData()).get('tagId'));
		if (!Number.isInteger(tagId)) return fail(400, { message: 'Etiqueta no válida' });
		await deleteTag(tagId);
	}
};
