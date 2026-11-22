import { and, desc, eq, isNull } from 'drizzle-orm';
import { agendaPeople, personOf } from '#lib/server/agenda/agenda.ts';
import { familyPerson, user, wish } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { FetchError, fetchPublic } from '#lib/server/public-fetch.ts';
import { clean, findOfType, readPage } from '#lib/server/recipes/schema-org.ts';
import { MAX_WISH_NOTE, MAX_WISH_TITLE, MAX_WISH_URL, shopOf } from '#lib/wishes.ts';

/**
 * Lista de deseos (#586): each person's, seen by the whole family. An adult writes in their own
 * and in the children's (the people without an account, or with a child's); in another adult's,
 * only «Lo regalo yo», which the person it is for never sees. A child sees and writes in its own.
 */

const USER_AGENT = 'Seilide/1.0 (https://github.com/yellowmachine/jellycartoon)';
const MAX_PAGE_BYTES = 5_000_000;

export interface Product {
	url: string;
	shop: string;
	title: string;
	imageUrl: string | null;
	priceCents: number | null;
	currency: string | null;
}

/** A link's address, or null: http(s) only, without its #. */
export function linkOf(address: unknown) {
	if (typeof address !== 'string') return null;
	const found = address.match(/https?:\/\/\S+/)?.[0];
	if (!found || found.length > MAX_WISH_URL) return null;
	try {
		const url = new URL(found);
		url.hash = '';
		return url.href;
	} catch {
		return null;
	}
}

/**
 * What came with the link when shared, as its name: the text without the address nor the shop's
 * name before a colon («Amazon.es: …»).
 */
export function titleFromShared(text: string | null | undefined) {
	const said = (text ?? '')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return tidyTitle(said);
}

/** «Amazon.es: Auriculares Sony : Electrónica» → «Auriculares Sony». */
export function tidyTitle(title: string) {
	return title
		.replace(/^(amazon|aliexpress)(\.[a-z.]+)?\s*[:|-]\s*/i, '')
		.replace(/\s+:\s+[^:]{1,40}$/, '')
		.trim()
		.slice(0, MAX_WISH_TITLE);
}

/**
 * The product's name in its address, where the shop writes it: Amazon's long links
 * (`/Sony-WH-1000XM5-Auriculares/dp/B09…`, the one copied on a computer). Empty if there is none.
 */
export function titleFromAddress(address: string) {
	let path: string;
	try {
		path = new URL(address).pathname;
	} catch {
		return '';
	}
	const slug = path.match(/\/([^/]+)\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:[/?]|$)/i)?.[1];
	if (!slug) return '';
	let words: string;
	try {
		words = decodeURIComponent(slug);
	} catch {
		return '';
	}
	words = words
		.replace(/[-_+]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return /\p{L}{3}/u.test(words) ? words.slice(0, MAX_WISH_TITLE) : '';
}

/**
 * A page's title that is only its site's name («Amazon.es»): what a shop that will not answer a
 * server shows instead of the product (Amazon's, with a 200), not a product's name.
 */
export const onlySiteName = (title: string, address: string) =>
	/^(www\.)?[\p{L}\d-]+(\.[a-z]{2,})+$/iu.test(title.trim()) ||
	title.trim().toLowerCase() === shopOf(address).toLowerCase();

/** schema.org's `image`: a string, a list, or an ImageObject. */
function imageOf(value: unknown, base: string): string | null {
	const first = Array.isArray(value) ? value[0] : value;
	const raw =
		typeof first === 'string'
			? first
			: first && typeof first === 'object'
				? (first as Record<string, unknown>).url
				: null;
	if (typeof raw !== 'string' || !raw) return null;
	try {
		const url = new URL(raw, base);
		return /^https?:$/.test(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/** «29.99», 29.99, «29,99»: in cents; null if it is not a price. */
export function centsOf(value: unknown): number | null {
	const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
	const plain = text.trim().replace(/\s/g, '');
	if (!/^\d+([.,]\d{1,2})?$/.test(plain)) return null;
	const cents = Math.round(Number(plain.replace(',', '.')) * 100);
	return cents > 0 && cents < 100_000_000 ? cents : null;
}

/** A Product's offers: one, a list, or an AggregateOffer with its lowest price. */
function priceOf(product: Record<string, unknown>) {
	const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
	if (!offers || typeof offers !== 'object') return null;
	const o = offers as Record<string, unknown>;
	const cents = centsOf(o.price) ?? centsOf(o.lowPrice);
	return cents === null
		? null
		: { cents, currency: typeof o.priceCurrency === 'string' ? o.priceCurrency : null };
}

/**
 * The product at that address: its page read for its schema.org Product, or its og:… tags. A shop
 * that will not answer a server (Amazon: a page with only its name, asking to use its API): with
 * what was shared with it as its name, or the one in its address, and its shop by where its short
 * link led.
 */
export async function readProduct(address: string, shared: string | null): Promise<Product> {
	const fallback = titleFromShared(shared);
	let page;
	try {
		page = await fetchPublic(address, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html,application/xhtml+xml',
				'Accept-Language': 'es-ES,es;q=0.9'
			},
			maxBytes: MAX_PAGE_BYTES
		});
	} catch (err) {
		const url = err instanceof FetchError && err.url ? (linkOf(err.url) ?? address) : address;
		return {
			url,
			shop: shopOf(url),
			title: fallback || titleFromAddress(url) || titleFromAddress(address) || shopOf(url),
			imageUrl: null,
			priceCents: null,
			currency: null
		};
	}
	const url = linkOf(page.url) ?? address;
	const read = /html/i.test(page.contentType) ? await readPage(page.body) : null;
	const product = read
		? (findOfType(read.jsonLd, 'Product') ?? findOfType(read.jsonLd, 'ProductGroup'))
		: null;
	const offer = product ? priceOf(product) : null;
	const metaCents = read
		? centsOf(read.meta['product:price:amount'] ?? read.meta['og:price:amount'])
		: null;
	const pageTitle = tidyTitle(clean(product?.name) || read?.title || '');
	const title =
		(pageTitle && (product || !onlySiteName(pageTitle, url)) ? pageTitle : '') ||
		fallback ||
		titleFromAddress(url) ||
		titleFromAddress(address) ||
		shopOf(url);
	return {
		url,
		shop: shopOf(url),
		title,
		imageUrl: (product && imageOf(product.image, url)) ?? imageOf(read?.imageUrl, url),
		priceCents: offer?.cents ?? metaCents,
		currency:
			offer?.currency ??
			(metaCents !== null
				? (read?.meta['product:price:currency'] ?? read?.meta['og:price:currency'] ?? null)
				: null)
	};
}

export interface WishPerson {
	id: string;
	name: string;
	kid: boolean;
	emoji: string | null;
	color: string | null;
	/** The one looking. */
	me: boolean;
	/** They may add, correct and remove in it. */
	writes: boolean;
}

export interface WishView {
	id: number;
	personId: string;
	url: string;
	shop: string;
	title: string;
	imageUrl: string | null;
	priceCents: number | null;
	currency: string | null;
	note: string | null;
	/** «Lo regalo yo»: by whom, and whether by the one looking; null for the person it is for. */
	gift: { mine: boolean; name: string } | null;
}

/** Whose lists the one looking sees, and in which they write. */
async function viewer(k: Kitchen, userId: string, kid: boolean) {
	const [people, mine] = await Promise.all([agendaPeople(k), personOf(k, userId)]);
	const all: WishPerson[] = people.map((p) => ({
		...p,
		me: p.id === mine,
		writes: p.id === mine || (!kid && p.kid)
	}));
	return { people: kid ? all.filter((p) => p.me) : all, mine };
}

/** The family's wishes as the one looking may see them, the newest first. */
export async function listWishes(k: Kitchen, userId: string, kid: boolean) {
	const { people, mine } = await viewer(k, userId, kid);
	const shown = new Set(people.map((p) => p.id));
	const rows = await k.run((tx) =>
		tx.select().from(wish).orderBy(desc(wish.createdAt), desc(wish.id))
	);
	const names = new Map((await accountNames(k)).map((a) => [a.userId, a.name]));
	const wishes: WishView[] = rows
		.filter((w) => shown.has(String(w.personId)))
		.map((w) => ({
			id: w.id,
			personId: String(w.personId),
			url: w.url,
			shop: w.shop,
			title: w.title,
			imageUrl: w.imageUrl,
			priceCents: w.priceCents,
			currency: w.currency,
			note: w.note,
			gift:
				String(w.personId) === mine || kid || !w.giftBy
					? null
					: { mine: w.giftBy === userId, name: names.get(w.giftBy) ?? 'Alguien' }
		}));
	return { people, wishes };
}

/** The family's people with an account: whose name a «Lo regalo yo» carries. */
function accountNames(k: Kitchen) {
	return k.run((tx) =>
		tx
			.select({ userId: user.id, name: user.name })
			.from(familyPerson)
			.innerJoin(user, eq(user.id, familyPerson.userId))
	);
}

/** Whether the one looking writes in that person's list. */
async function writesIn(k: Kitchen, userId: string, kid: boolean, personId: number) {
	const { people } = await viewer(k, userId, kid);
	return people.some((p) => p.id === String(personId) && p.writes);
}

/** The person a wish is for; null if it is not there. */
async function wishPerson(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ personId: wish.personId }).from(wish).where(eq(wish.id, id))
	);
	return row?.personId ?? null;
}

/** A product into that person's list: false if the one looking may not write in it. */
export async function addWish(
	k: Kitchen,
	userId: string,
	kid: boolean,
	personId: number,
	product: Product,
	note: string | null
) {
	if (!(await writesIn(k, userId, kid, personId))) return false;
	await k.run((tx) =>
		tx.insert(wish).values({
			familyId: k.familyId,
			personId,
			...product,
			title: product.title.slice(0, MAX_WISH_TITLE),
			note: note?.trim().slice(0, MAX_WISH_NOTE) || null,
			addedBy: userId
		})
	);
	return true;
}

/** Its name and note corrected; false if it is not there or not theirs to write. */
export async function updateWish(
	k: Kitchen,
	userId: string,
	kid: boolean,
	id: number,
	change: { title: string; note: string | null }
) {
	const personId = await wishPerson(k, id);
	if (personId === null || !(await writesIn(k, userId, kid, personId))) return false;
	const title = change.title.trim().slice(0, MAX_WISH_TITLE);
	if (!title) return false;
	await k.run((tx) =>
		tx
			.update(wish)
			.set({ title, note: change.note?.trim().slice(0, MAX_WISH_NOTE) || null })
			.where(eq(wish.id, id))
	);
	return true;
}

export async function deleteWish(k: Kitchen, userId: string, kid: boolean, id: number) {
	const personId = await wishPerson(k, id);
	if (personId === null || !(await writesIn(k, userId, kid, personId))) return false;
	await k.run((tx) => tx.delete(wish).where(eq(wish.id, id)));
	return true;
}

/**
 * «Lo regalo yo» (`on`), or no longer: by an adult, for someone else, and not over another's.
 * False if it cannot be.
 */
export async function giveWish(k: Kitchen, userId: string, kid: boolean, id: number, on: boolean) {
	if (kid) return false;
	const personId = await wishPerson(k, id);
	if (personId === null || String(personId) === (await personOf(k, userId))) return false;
	const [done] = await k.run((tx) =>
		tx
			.update(wish)
			.set({ giftBy: on ? userId : null })
			.where(and(eq(wish.id, id), on ? isNull(wish.giftBy) : eq(wish.giftBy, userId)))
			.returning({ id: wish.id })
	);
	return Boolean(done);
}
