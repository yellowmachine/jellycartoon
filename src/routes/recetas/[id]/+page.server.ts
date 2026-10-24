import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	backdropRecipeId,
	deleteRecipe,
	getRecipe,
	toggleBackdrop
} from '#lib/server/recipes/import.ts';

export const load: PageServerLoad = async ({ params }) => {
	const recipe = await getRecipe(Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return { recipe, isBackdrop: (await backdropRecipeId()) === recipe.id };
};

export const actions: Actions = {
	/** This recipe's picture behind the book's page, or (if it already is) no picture. */
	backdrop: async ({ params }) => {
		await toggleBackdrop(Number(params.id));
	},
	delete: async ({ params }) => {
		await deleteRecipe(Number(params.id));
		redirect(303, '/recetas');
	}
};
