import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importRecipe, listRecipes } from '#lib/server/recipes/import.ts';

/**
 * The house's recipe book (#60). Also where «Compartir → JellyCartoon» lands, from a phone's
 * browser (the manifest's share_target): the shared address comes in `url` or, from Android,
 * inside `text`, and waits in the box for a tap.
 */
export const load: PageServerLoad = async ({ url }) => {
	const shared = [url.searchParams.get('url'), url.searchParams.get('text')]
		.map((v) => v?.match(/https?:\/\/\S+/)?.[0] ?? null)
		.find(Boolean);
	return { recipes: await listRecipes(), shared: shared ?? null };
};

export const actions: Actions = {
	import: async ({ request, locals }) => {
		const address = String((await request.formData()).get('url') ?? '').trim();
		if (!address) return fail(400, { url: address, error: 'Falta la dirección de la receta' });
		let id;
		try {
			({ id } = await importRecipe(address, locals.user!.id));
		} catch (err) {
			return fail(400, { url: address, error: err instanceof Error ? err.message : String(err) });
		}
		redirect(303, `/recetas/${id}`);
	}
};
