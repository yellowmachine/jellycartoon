import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { analyzeWish } from '#lib/server/wish-analysis.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import {
	addWish,
	linkOf,
	listWishes,
	productFromBrowser,
	readProduct
} from '#lib/server/wishes.ts';
import {
	knownShop,
	BOOKMARK_VERSION,
	MAX_PAGE_TEXT,
	MAX_WISH_NOTE,
	priceChangeParam,
	priceFromText,
	priceText
} from '#lib/wishes.ts';

/**
 * A link shared with Seilide that is not a map's nor its own (#586): into someone's wishes, a
 * recipe, or sent by Mensajes. A known shop's comes with the wishes first; any other, with the recipe.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const link = linkOf(url.searchParams.get('url'));
	if (!link) redirect(303, '/');
	const userId = locals.user!.id;
	const kid = await isKidAccount(userId);
	const k = await kitchenOf(userId);
	const { people } = await listWishes(k, userId, kid);
	const shop = knownShop(link);
	// From the computer's bookmark: what the browser read, shown and kept as it is.
	const read = productFromBrowser((name) => url.searchParams.get(name));
	return {
		link,
		text: url.searchParams.get('texto') ?? read?.title ?? '',
		read: read
			? {
					title: read.title,
					imageUrl: read.imageUrl,
					price: priceText(read.priceCents, read.currency),
					precio: url.searchParams.get('precio') ?? '',
					foto: read.imageUrl ?? '',
					nota: (url.searchParams.get('nota') ?? '').slice(0, MAX_WISH_NOTE)
				}
			: null,
		shop,
		people: people.filter((p) => p.writes),
		/** Read by an earlier bookmark than today's. */
		oldBookmark: Boolean(read) && Number(url.searchParams.get('v') ?? 0) < BOOKMARK_VERSION,
		/** «Analizar con IA»: the grown-ups', with the family's key. */
		ai: Boolean(read) && !kid && Boolean(await openRouterKey(k)),
		/** Mensajes is the grown-ups' (#551). */
		messages: !kid
	};
};

export const actions: Actions = {
	/** «Analizar con IA»: the page's text, from the bookmark; what it says, for the card. */
	analyze: async ({ request, locals }) => {
		const userId = locals.user!.id;
		if (await isKidAccount(userId)) return fail(403, { message: 'Esto es de los mayores' });
		const text = (await request.formData()).get('pagina');
		if (typeof text !== 'string' || text.length > 2 * MAX_PAGE_TEXT)
			return fail(400, { message: 'No ha llegado el texto de la página' });
		const read = await analyzeWish(await kitchenOf(userId), text);
		if ('problem' in read) return fail(503, { message: read.problem });
		return { analysis: read };
	},
	wish: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const link = linkOf(form.get('url'));
		const personId = Number(form.get('persona'));
		if (!link || !Number.isInteger(personId) || personId <= 0)
			return fail(400, { message: 'Falta el enlace o para quién es' });
		const texto = form.get('texto');
		const field = (name: string) => {
			const v = form.get(name);
			return typeof v === 'string' ? v : null;
		};
		const precio = field('precio');
		if (precio?.trim() && !priceFromText(precio))
			return fail(400, { message: 'Ese precio no se entiende: 12,30' });
		const product =
			productFromBrowser(field) ??
			(await readProduct(link, typeof texto === 'string' ? texto : null));
		const done = await addWish(
			await kitchenOf(userId),
			userId,
			await isKidAccount(userId),
			personId,
			product,
			field('nota')
		);
		if ('refused' in done) return fail(403, { message: 'En esa lista no puedes añadir' });
		// Already there: that one, shown, rather than a second.
		redirect(
			303,
			'already' in done
				? `/deseos?persona=${personId}&ya=${done.already}${done.change ? `&precio=${priceChangeParam(done.change)}` : ''}`
				: `/deseos?persona=${personId}`
		);
	}
};
