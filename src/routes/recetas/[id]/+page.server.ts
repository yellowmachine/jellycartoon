import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deleteRecipe, getRecipe } from '#lib/server/recipes/import.ts';

export const load: PageServerLoad = async ({ params }) => {
	const recipe = await getRecipe(Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return { recipe };
};

export const actions: Actions = {
	delete: async ({ params }) => {
		await deleteRecipe(Number(params.id));
		redirect(303, '/recetas');
	}
};
