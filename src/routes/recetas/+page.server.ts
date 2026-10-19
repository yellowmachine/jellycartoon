import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importRecipe, listRecipes } from '#lib/server/recipes/import.ts';
import {
	addRecipeSite,
	indexSite,
	listRecipeSites,
	removeRecipeSite,
	searchRecipeSites
} from '#lib/server/recipes/sites.ts';

/**
 * The house's recipe book (#60). Also where «Compartir → JellyCartoon» lands, from a phone's
 * browser (the manifest's share_target): the shared address comes in `url` or, from Android,
 * inside `text`, and waits in the box for a tap.
 */
export const load: PageServerLoad = async ({ url }) => {
	const shared = [url.searchParams.get('url'), url.searchParams.get('text')]
		.map((v) => v?.match(/https?:\/\/\S+/)?.[0] ?? null)
		.find(Boolean);
	const q = url.searchParams.get('q')?.trim() ?? '';
	const [recipes, sites, results] = await Promise.all([
		listRecipes(),
		listRecipeSites(),
		q ? searchRecipeSites(q, undefined, 30) : null
	]);
	return { recipes, sites, q, results, shared: shared ?? null };
};

const siteId = async (request: Request) => Number((await request.formData()).get('id'));

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
	},
	/** A favourite site, by any of its pages: its map is read in the background. */
	addSite: async ({ request, locals }) => {
		const address = String((await request.formData()).get('site') ?? '').trim();
		if (!address) return fail(400, { site: address, siteError: 'Falta la dirección de la web' });
		try {
			await addRecipeSite(address, locals.user!.id);
		} catch (err) {
			return fail(400, {
				site: address,
				siteError: err instanceof Error ? err.message : String(err)
			});
		}
	},
	refreshSite: async ({ request }) => {
		void indexSite(await siteId(request));
	},
	removeSite: async ({ request }) => {
		await removeRecipeSite(await siteId(request));
	}
};
