import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recipesBackdropId, toggleRecipesBackdrop } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { importRecipe, listRecipes, recipesBackdrop } from '#lib/server/recipes/import.ts';

/** The family's recipe book; `?url=`, a recipe shared from a phone (through jellycartoon). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const [recipes, backdrop, backdropId] = await Promise.all([
		listRecipes(k),
		recipesBackdrop(k),
		recipesBackdropId(k)
	]);
	const shared = url.searchParams.get('url')?.match(/^https?:\/\/\S+$/)?.[0] ?? null;
	return { recipes, backdrop, backdropId, shared };
};

export const actions: Actions = {
	/** A recipe's picture behind this page, from the button on it; again, no picture. */
	backdrop: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { message: 'Receta no válida' });
		await toggleRecipesBackdrop(await kitchenOf(locals.user!.id), id);
	},
	import: async ({ request, locals }) => {
		const address = String((await request.formData()).get('url') ?? '').trim();
		if (!address) return fail(400, { url: address, error: 'Falta la dirección de la receta' });
		let id;
		try {
			({ id } = await importRecipe(await kitchenOf(locals.user!.id), address));
		} catch (err) {
			return fail(400, { url: address, error: err instanceof Error ? err.message : String(err) });
		}
		redirect(303, `/recetas/${id}`);
	}
};
