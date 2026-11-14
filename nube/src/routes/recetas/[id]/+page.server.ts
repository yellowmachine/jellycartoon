import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recipesBackdropId, toggleRecipesBackdrop } from '#lib/server/family-settings.ts';
import { addItems, kitchenOf, toBuy } from '#lib/server/fridge.ts';
import { deleteRecipe, getRecipe, sourceLink } from '#lib/server/recipes/import.ts';
import {
	NotAPhoto,
	pictureFromSites,
	removeRecipePhoto,
	setRecipePhoto
} from '#lib/server/recipes/photos.ts';
import { recipeShopping } from '#lib/server/recipes/shopping.ts';
import { refused } from '#lib/server/storage.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const recipe = await getRecipe(k, Number(params.id));
	if (!recipe) error(404, 'Receta no encontrada');
	return {
		recipe,
		link: sourceLink(recipe.sourceUrl),
		isBackdrop: (await recipesBackdropId(k)) === recipe.id
	};
};

export const actions: Actions = {
	/** This recipe's picture behind the book's page, or (if it already is) no picture. */
	backdrop: async ({ params, locals }) => {
		await toggleRecipesBackdrop(await kitchenOf(locals.user!.id), Number(params.id));
	},
	/**
	 * «Añadir a la compra»: its ingredients as things to buy (made by the AI the first time), and
	 * what is already on the list, to show them as such.
	 */
	shopping: async ({ params, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const [found, buying] = await Promise.all([recipeShopping(k, Number(params.id)), toBuy(k)]);
		if (!found) return fail(404, { message: 'Receta no encontrada' });
		return { shopping: found.items, byAi: found.byAi, toBuy: buying };
	},
	/** The ticked ones onto the family's shopping list. */
	add: async ({ request, locals }) => {
		const ticked = (await request.formData()).getAll('item').map(String).slice(0, 60);
		if (!ticked.length) return fail(400, { message: 'Marca algo para añadir' });
		const k = await kitchenOf(locals.user!.id);
		await addItems(k, ticked);
		return { added: ticked, toBuy: await toBuy(k) };
	},
	/** «📷 Poner foto»: the family's own photo of the dish, made smaller in the browser. */
	photo: async ({ params, request, locals }) => {
		const file = (await request.formData()).get('photo');
		if (!(file instanceof File) || !file.size) return fail(400, { photoProblem: 'Elige una foto' });
		try {
			const done = await setRecipePhoto(
				await kitchenOf(locals.user!.id),
				Number(params.id),
				new Uint8Array(await file.arrayBuffer())
			);
			if (!done) return fail(404, { photoProblem: 'Receta no encontrada' });
		} catch (err) {
			if (err instanceof NotAPhoto) return fail(400, { photoProblem: err.message });
			const no = refused(err);
			if (no) return fail(no.status, { photoProblem: no.message });
			throw err;
		}
		return { photoSaved: true };
	},
	/** Its own photo gone: the site's again, if it has one. */
	removePhoto: async ({ params, locals }) => {
		await removeRecipePhoto(await kitchenOf(locals.user!.id), Number(params.id));
	},
	/** «🔎 Buscar foto en mis webs»: one of the same dish from the favourite sites. */
	findPicture: async ({ params, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const r = await getRecipe(k, Number(params.id));
		if (!r) return fail(404, { photoProblem: 'Receta no encontrada' });
		if (!(await pictureFromSites(k, r.id, r.title)))
			return fail(404, {
				photoProblem: 'No he encontrado este plato en tus webs favoritas (Recetas → Webs favoritas)'
			});
		return { pictureFound: true };
	},
	delete: async ({ params, locals }) => {
		await deleteRecipe(await kitchenOf(locals.user!.id), Number(params.id));
		redirect(303, '/recetas');
	}
};
