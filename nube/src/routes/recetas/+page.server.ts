import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recipesBackdropId, toggleRecipesBackdrop } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { importRecipe, listRecipes, recipesBackdrop } from '#lib/server/recipes/import.ts';
import {
	addRecipeSite,
	indexSite,
	listRecipeSites,
	refreshStale,
	removeRecipeSite,
	renameRecipeSite,
	searchRecipeSites
} from '#lib/server/recipes/sites.ts';

/**
 * The family's recipe book, as jellycartoon's (#60). Also where a recipe shared from a phone lands
 * (through jellycartoon's «Compartir»): its address in `url`, waiting in the box for a tap.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	// The favourite sites read more than a week ago, again, in the background.
	refreshStale(k);
	const shared = url.searchParams.get('url')?.match(/^https?:\/\/\S+$/)?.[0] ?? null;
	const q = url.searchParams.get('q')?.trim() ?? '';
	const [recipes, backdrop, backdropId, sites, results] = await Promise.all([
		listRecipes(k),
		recipesBackdrop(k),
		recipesBackdropId(k),
		listRecipeSites(k),
		q ? searchRecipeSites(k, q, undefined, 30) : null
	]);
	return { recipes, backdrop, backdropId, sites, q, results, shared };
};

const siteId = async (request: Request) => Number((await request.formData()).get('id'));

export const actions: Actions = {
	/** A recipe's picture behind this page, from the button on it; again, no picture. */
	backdrop: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { message: 'Receta no válida' });
		await toggleRecipesBackdrop(await kitchenOf(locals.user!.id), id);
	},
	import: async ({ request, locals }) => {
		const address = String((await request.formData()).get('url') ?? '').trim();
		if (!address) return fail(400, { url: address, error: 'Falta la dirección de la receta' });
		let id;
		try {
			({ id } = await importRecipe(await kitchenOf(locals.user!.id), address));
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
			await addRecipeSite(await kitchenOf(locals.user!.id), address);
		} catch (err) {
			return fail(400, {
				site: address,
				siteError: err instanceof Error ? err.message : String(err)
			});
		}
	},
	refreshSite: async ({ request, locals }) => {
		void indexSite(await kitchenOf(locals.user!.id), await siteId(request));
	},
	renameSite: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '')
			.trim()
			.slice(0, 80);
		if (!name) return fail(400, { siteError: 'El nombre no puede quedar vacío' });
		await renameRecipeSite(await kitchenOf(locals.user!.id), Number(form.get('id')), name);
	},
	removeSite: async ({ request, locals }) => {
		await removeRecipeSite(await kitchenOf(locals.user!.id), await siteId(request));
	}
};
