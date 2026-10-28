import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { importRecipe, listRecipes } from '#lib/server/recipes/import.ts';
import { isFavouritePage, listRecipeSites, refreshStale } from '#lib/server/recipes/sites.ts';

/**
 * The family's recipe book and favourite sites, for its house's voice («vamos a hacer los
 * macarrones»): what it can cook, and where it can look for more.
 */
export const GET: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	refreshStale(k);
	const [recipes, sites] = await Promise.all([listRecipes(k), listRecipeSites(k)]);
	return json({
		recipes,
		sites: sites.map((s) => ({ id: s.id, name: s.name, host: s.host }))
	});
};

/**
 * A recipe of a favourite site saved, by the voice («cocina la receta de…»): only a page of theirs,
 * one its search found, not any address the AI writes.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	if (typeof body?.url !== 'string') error(400, 'Falta la dirección');
	if (!(await isFavouritePage(k, body.url)))
		error(422, 'Esa dirección no es de una web favorita: búscala antes en ellas');
	try {
		return json(await importRecipe(k, body.url));
	} catch (err) {
		error(422, err instanceof Error ? err.message : String(err));
	}
};
