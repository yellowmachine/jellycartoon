import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { getRecipe } from '#lib/server/recipes/import.ts';

/** One recipe, to cook it by voice step by step. */
export const GET: RequestHandler = async ({ request, params }) => {
	const recipe = await getRecipe(await houseRequest(request), Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return json({ recipe });
};
