import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { importRecipe, listRecipes } from '#lib/server/recipes/import.ts';

/** The family's recipe book, for its house's voice («vamos a hacer los macarrones»). */
export const GET: RequestHandler = async ({ request }) =>
	json({ recipes: await listRecipes(await houseRequest(request)) });

/** A recipe saved from a web page, by the voice («cocina la receta de…»). */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	if (typeof body?.url !== 'string') error(400, 'Falta la dirección');
	try {
		return json(await importRecipe(k, body.url));
	} catch (err) {
		error(422, err instanceof Error ? err.message : String(err));
	}
};
