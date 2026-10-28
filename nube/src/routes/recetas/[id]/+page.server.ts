import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recipesBackdropId, toggleRecipesBackdrop } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { deleteRecipe, getRecipe } from '#lib/server/recipes/import.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const recipe = await getRecipe(k, Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return { recipe, isBackdrop: (await recipesBackdropId(k)) === recipe.id };
};

export const actions: Actions = {
	/** This recipe's picture behind the book's page, or (if it already is) no picture. */
	backdrop: async ({ params, locals }) => {
		await toggleRecipesBackdrop(await kitchenOf(locals.user!.id), Number(params.id));
	},
	delete: async ({ params, locals }) => {
		await deleteRecipe(await kitchenOf(locals.user!.id), Number(params.id));
		redirect(303, '/recetas');
	}
};
