import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	backdropRecipeId,
	importRecipe,
	listRecipes,
	recipesBackdrop,
	toggleBackdrop
} from '#lib/server/recipes/import.ts';
import {
	addRecipeSite,
	indexSite,
	listRecipeSites,
	removeRecipeSite,
	renameRecipeSite,
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
	const [recipes, backdrop, backdropId, sites, results] = await Promise.all([
		listRecipes(),
		recipesBackdrop(),
		backdropRecipeId(),
		listRecipeSites(),
		q ? searchRecipeSites(q, undefined, 30) : null
	]);
	return { recipes, backdrop, backdropId, sites, q, results, shared: shared ?? null };
};

const siteId = async (request: Request) => Number((await request.formData()).get('id'));

export const actions: Actions = {
	/** A recipe's picture behind this page, from the button on it; again, no picture. */
	backdrop: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { message: 'Receta no válida' });
		await toggleBackdrop(id);
	},
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
	renameSite: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '')
			.trim()
			.slice(0, 80);
		if (!name) return fail(400, { siteError: 'El nombre no puede quedar vacío' });
		await renameRecipeSite(Number(form.get('id')), name);
	},
	removeSite: async ({ request }) => {
		await removeRecipeSite(await siteId(request));
	}
};
