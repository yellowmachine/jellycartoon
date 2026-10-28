import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { searchRecipeSites } from '#lib/server/recipes/sites.ts';

/** The voice searching the favourite sites: `q`, the dish; `web`, only in that one. */
export const GET: RequestHandler = async ({ request, url }) => {
	const k = await houseRequest(request);
	const q = url.searchParams.get('q')?.trim();
	if (!q) error(400, 'Falta qué buscar');
	const web = Number(url.searchParams.get('web'));
	return json({
		results: await searchRecipeSites(k, q, Number.isInteger(web) && web > 0 ? web : undefined, 6)
	});
};
