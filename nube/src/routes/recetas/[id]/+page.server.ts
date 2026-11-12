import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recipesBackdropId, toggleRecipesBackdrop } from '#lib/server/family-settings.ts';
import { addItems, kitchenOf, toBuy } from '#lib/server/fridge.ts';
import { deleteRecipe, getRecipe, sourceLink } from '#lib/server/recipes/import.ts';
import { recipeShopping } from '#lib/server/recipes/shopping.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const recipe = await getRecipe(k, Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return {
		recipe,
		link: sourceLink(recipe.sourceUrl),
		isBackdrop: (await recipesBackdropId(k)) === recipe.id
	};
};

export const actions: Actions = {
	/** This recipe's picture behind the book's page, or (if it already is) no picture. */
	backdrop: async ({ params, locals }) => {
		await toggleRecipesBackdrop(await kitchenOf(locals.user!.id), Number(params.id));
	},
	/**
	 * «Añadir a la compra»: its ingredients as things to buy (made by the AI the first time), and
	 * what is already on the list, to show them as such.
	 */
	shopping: async ({ params, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const [found, buying] = await Promise.all([recipeShopping(k, Number(params.id)), toBuy(k)]);
		if (!found) return fail(404, { message: 'Receta no encontrada' });
		return { shopping: found.items, byAi: found.byAi, toBuy: buying };
	},
	/** The ticked ones onto the family's shopping list. */
	add: async ({ request, locals }) => {
		const ticked = (await request.formData()).getAll('item').map(String).slice(0, 60);
		if (!ticked.length) return fail(400, { message: 'Marca algo para añadir' });
		const k = await kitchenOf(locals.user!.id);
		await addItems(k, ticked);
		return { added: ticked, toBuy: await toBuy(k) };
	},
	delete: async ({ params, locals }) => {
		await deleteRecipe(await kitchenOf(locals.user!.id), Number(params.id));
		redirect(303, '/recetas');
	}
};
