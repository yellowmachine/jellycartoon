import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { addWish, linkOf, listWishes, readProduct } from '#lib/server/wishes.ts';
import { knownShop } from '#lib/wishes.ts';

/**
 * A link shared with Seilide that is not a map's nor its own (#586): into someone's wishes, or a
 * recipe. A known shop's comes with the wishes first; any other, with the recipe.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const link = linkOf(url.searchParams.get('url'));
	if (!link) redirect(303, '/');
	const userId = locals.user!.id;
	const { people } = await listWishes(await kitchenOf(userId), userId, await isKidAccount(userId));
	const shop = knownShop(link);
	return {
		link,
		text: url.searchParams.get('texto') ?? '',
		shop,
		people: people.filter((p) => p.writes)
	};
};

export const actions: Actions = {
	wish: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const link = linkOf(form.get('url'));
		const personId = Number(form.get('persona'));
		if (!link || !Number.isInteger(personId) || personId <= 0)
			return fail(400, { message: 'Falta el enlace o para quién es' });
		const texto = form.get('texto');
		const product = await readProduct(link, typeof texto === 'string' ? texto : null);
		const added = await addWish(
			await kitchenOf(userId),
			userId,
			await isKidAccount(userId),
			personId,
			product,
			null
		);
		if (!added) return fail(403, { message: 'En esa lista no puedes añadir' });
		redirect(303, `/deseos?persona=${personId}`);
	}
};
