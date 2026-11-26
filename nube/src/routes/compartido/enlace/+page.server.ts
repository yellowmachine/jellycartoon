import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { analyzeWish } from '#lib/server/wish-analysis.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { addWebNote } from '#lib/server/notes.ts';
import { subscribe, userPodcasts } from '#lib/server/podcasts/podcasts.ts';
import { linkKinds } from '#lib/server/shared-link.ts';
import { linkOrder } from '#lib/shared-link.ts';
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
	priceText,
	sameCurrency,
	shippingField,
	shippingFromText
} from '#lib/wishes.ts';

/**
 * A link shared with Seilide that is not a map's nor its own (#586, #633): into someone's wishes, a
 * recipe, a podcast to follow, a note to read later, or sent by Mensajes. What it most likely is,
 * first (lib/shared-link.ts): a podcast, a recipe, a shop's product, else a note.
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
	const version = Number(url.searchParams.get('v') ?? 0);
	// What it is: a known shop's, a product; else from the bookmark's hints, or the page read here.
	const kinds = shop
		? { recipe: false, podcast: null }
		: await linkKinds(link, {
				recipe: version >= 5 ? url.searchParams.get('receta') === '1' : null,
				feed: version >= 5 ? url.searchParams.get('feed') : null
			});
	const followed = kinds.podcast
		? (await userPodcasts(k)).find((p) => p.feedUrl === kinds.podcast!.feedUrl)
		: undefined;
	const priced = Boolean(read?.priceCents);
	return {
		link,
		text: url.searchParams.get('texto') ?? read?.title ?? '',
		read: read
			? {
					title: read.title,
					imageUrl: read.imageUrl,
					price: priceText(read.priceCents, read.currency),
					precio: url.searchParams.get('precio') ?? '',
					envio: shippingField(read.shippingCents),
					foto: read.imageUrl ?? '',
					nota: (url.searchParams.get('nota') ?? '').slice(0, MAX_WISH_NOTE)
				}
			: null,
		shop,
		people: people.filter((p) => p.writes),
		/** Read by an earlier bookmark than today's. */
		oldBookmark: Boolean(read) && version < BOOKMARK_VERSION,
		podcast: kinds.podcast && { ...kinds.podcast, followed: followed?.id ?? null },
		order: linkOrder({
			wish: Boolean(shop) || priced,
			recipe: kinds.recipe,
			podcast: Boolean(kinds.podcast),
			canWish: people.some((p) => p.writes),
			canNote: !kid
		}),
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
	/** «Suscribirme» (#633): followed in Radio → Podcasts; already, the same. */
	podcast: async ({ request, locals }) => {
		const feed = (await request.formData()).get('feed');
		if (typeof feed !== 'string' || !feed) return fail(400, { message: 'Falta el podcast' });
		let id: number;
		try {
			id = await subscribe(await kitchenOf(locals.user!.id), feed);
		} catch (err) {
			return fail(502, {
				message: err instanceof Error ? err.message : 'No se pudo leer el podcast'
			});
		}
		redirect(303, `/radio/podcasts/${id}`);
	},
	/** «Guardar en Notas» (#633): its name and the link, private, to read later. Not for children. */
	note: async ({ request, locals }) => {
		const userId = locals.user!.id;
		if (await isKidAccount(userId)) return fail(403, { message: 'Notas es de los mayores' });
		const form = await request.formData();
		const link = linkOf(form.get('url'));
		if (!link) return fail(400, { message: 'Falta el enlace' });
		const title = String(form.get('titulo') ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 300);
		const { id, read } = await addWebNote(await kitchenOf(userId), userId, { link, title });
		redirect(303, `/notas/${id}/leer${read ? '' : '?sin=1'}`);
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
		const envio = shippingFromText(field('envio'));
		if (field('envio')?.trim() && !envio)
			return fail(400, { message: 'Ese envío no se entiende: 4,99 o gratis' });
		if (envio?.currency && !sameCurrency(envio.currency, priceFromText(precio)?.currency ?? null))
			return fail(400, { message: 'El envío, en la misma moneda que el precio' });
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
