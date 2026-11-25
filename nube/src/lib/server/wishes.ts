import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { agendaPeople, personOf } from '#lib/server/agenda/agenda.ts';
import { familyPerson, user, wish } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { Tool } from '#lib/server/openrouter.ts';
import { FetchError, fetchPublic } from '#lib/server/public-fetch.ts';
import { clean, findOfType, readPage } from '#lib/server/recipes/schema-org.ts';
import {
	cleanLink,
	knownShop,
	MAX_WISH_NOTE,
	MAX_WISH_TITLE,
	MAX_WISH_URL,
	costText,
	priceFromText,
	sameCurrency,
	shippingFromText,
	seenOn,
	shopOf,
	WISH_PRIORITIES,
	WISH_PRIORITY_LABELS,
	PRICE_SOURCES,
	type Price,
	type PriceChange,
	type PriceSource,
	type WishCard,
	type WishPriority
} from '#lib/wishes.ts';

/**
 * Lista de deseos (#586): each person's, seen by the whole family. An adult writes in their own
 * and in the children's (the people without an account, or with a child's); in another adult's,
 * only «Lo regalo yo», which the person it is for never sees. A child sees and writes in its own.
 */

const USER_AGENT = 'Seilide/1.0 (https://github.com/yellowmachine/jellycartoon)';
const MAX_PAGE_BYTES = 5_000_000;

export interface Product {
	/** Clean (cleanLink): without tracking, Amazon's as /dp/<ASIN>. */
	url: string;
	/** The same for one product however it was shared. */
	productKey: string;
	shop: string;
	title: string;
	imageUrl: string | null;
	priceCents: number | null;
	currency: string | null;
	/** What sending it costs, in that currency: 0, free; not said, not known. */
	shippingCents?: number | null;
	/** Who read it; not said, the server. */
	priceSource?: PriceSource;
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

type Node = Record<string, unknown>;
const nodes = (v: unknown) =>
	[v].flat().filter((n): n is Node => Boolean(n) && typeof n === 'object');

const SPAIN = ['es', 'esp', 'spain', 'españa'];

/** 2, a shipping to all of Spain; 1, to nowhere said; 0, elsewhere, or only to a part of it. */
function reach(details: Node) {
	const destinations = nodes(details.shippingDestination);
	if (!destinations.length) return 1;
	return destinations.some(
		(d) =>
			!(d.addressRegion || d.postalCode || d.postalCodePrefix || d.postalCodeRange) &&
			[d.addressCountry].flat().some((c) => {
				const node = nodes(c)[0];
				return SPAIN.includes(
					String(node ? (node.name ?? node.identifier) : c)
						.trim()
						.toLowerCase()
				);
			})
	)
		? 2
		: 0;
}

/**
 * What its offer says sending it to Spain costs (schema.org `shippingDetails`), in cents: 0, free;
 * null if it is not clear: several that differ, with conditions, or in another currency. The
 * bookmark's is the same (lib/wishes.ts SHIPPING).
 */
export function shippingOf(offer: Node, product: Node, currency: string | null): number | null {
	const own = nodes(offer.shippingDetails);
	const all = (own.length ? own : nodes(product.shippingDetails))
		.filter((d) => String(d.doesNotShip) !== 'true')
		.map((details) => ({ details, to: reach(details) }));
	const best = all.some((a) => a.to === 2) ? 2 : 1;
	const costs = new Set<number | null>(
		all
			.filter((a) => a.to === best)
			.map(({ details: d }) => {
				const rates = nodes(d.shippingRate);
				const rate = rates[0];
				if (rates.length !== 1 || d.shippingConditions || d.orderValue || d.weight) return null;
				if (typeof rate!.currency === 'string' && !sameCurrency(rate!.currency, currency))
					return null;
				const plain = String(rate!.value ?? '').trim();
				if (!/^\d+([.,]\d{1,2})?$/.test(plain)) return null;
				const cents = Math.round(Number(plain.replace(',', '.')) * 100);
				return cents < 100_000_000 ? cents : null;
			})
	);
	return costs.size === 1 ? [...costs][0]! : null;
}

/** A Product's first price: in its offers (one, a list, an AggregateOffer), or their specification; and its shipping. */
function priceOf(product: Record<string, unknown>) {
	for (const offer of nodes(product.offers))
		for (const o of [offer, ...nodes(offer.priceSpecification)]) {
			const cents = centsOf(o.price) ?? centsOf(o.lowPrice);
			if (cents === null) continue;
			const said = o.priceCurrency ?? offer.priceCurrency;
			const currency = typeof said === 'string' ? said : null;
			return { cents, currency, shipping: shippingOf(offer, product, currency) };
		}
	return null;
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
		const kept = cleanLink(url);
		return {
			url: kept.url,
			productKey: kept.key,
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
	// Its microdata: «13,99» in its attribute, or «13,99 €» as its text.
	const said = read?.microdata.price ?? null;
	const microCents = centsOf(said) ?? priceFromText(said)?.cents ?? null;
	const pageTitle = tidyTitle(clean(product?.name) || read?.title || '');
	const title =
		(pageTitle && (product || !onlySiteName(pageTitle, url)) ? pageTitle : '') ||
		fallback ||
		titleFromAddress(url) ||
		titleFromAddress(address) ||
		shopOf(url);
	const kept = cleanLink(url);
	return {
		url: kept.url,
		productKey: kept.key,
		shop: shopOf(url),
		title,
		imageUrl: (product && imageOf(product.image, url)) ?? imageOf(read?.imageUrl, url),
		priceCents: offer?.cents ?? metaCents ?? microCents,
		currency:
			offer?.currency ??
			(metaCents !== null
				? (read?.meta['product:price:currency'] ?? read?.meta['og:price:currency'] ?? null)
				: microCents !== null
					? (read?.microdata.currency ?? priceFromText(said)?.currency ?? null)
					: null),
		shippingCents: offer?.shipping ?? null
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
	/** In that currency: 0, free; null, not known. */
	shippingCents: number | null;
	/** When the price was seen. */
	priceAt: Date | null;
	note: string | null;
	priority: WishPriority;
	/** «Lo regalo yo»: by whom, and whether by the one looking; null for the person it is for. */
	gift: { mine: boolean; name: string } | null;
	/** «Comprado»: null also for the person it is for, if another bought it. */
	bought: { mine: boolean; name: string; on: string; expenseId: number | null } | null;
	/** Whether the one looking may say «Comprado». */
	buys: boolean;
}

/** A wish the one looking may say «Comprado» of: an adult; theirs, a child's, or one they give. */
function mayBuy(
	w: typeof wish.$inferSelect,
	userId: string,
	kid: boolean,
	person: WishPerson | undefined
) {
	if (kid || !person) return false;
	// Their own, also when another bought it in secret: it looks to them as not bought.
	if (person.me) return !w.boughtOn || w.boughtBy !== userId;
	if (w.boughtOn) return false;
	return w.giftBy ? w.giftBy === userId : person.writes;
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
			// Kept by its address, when it was not known yet: with the rest of its shop's.
			shop: (w.shop.includes('.') && knownShop(w.url)) || w.shop,
			title: w.title,
			imageUrl: w.imageUrl,
			priceCents: w.priceCents,
			currency: w.currency,
			shippingCents: w.shippingCents,
			priceAt: w.priceAt,
			note: w.note,
			priority: w.priority,
			gift:
				String(w.personId) === mine || kid || !w.giftBy
					? null
					: { mine: w.giftBy === userId, name: names.get(w.giftBy) ?? 'Alguien' },
			bought:
				!w.boughtOn || ((kid || String(w.personId) === mine) && w.boughtBy !== userId)
					? null
					: {
							mine: w.boughtBy === userId,
							name: names.get(w.boughtBy ?? '') ?? 'Alguien',
							on: w.boughtOn,
							expenseId: w.expenseId
						},
			buys: mayBuy(
				w,
				userId,
				kid,
				people.find((p) => p.id === String(w.personId))
			)
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

/**
 * A product into that person's list: `added`; `refused` if the one looking may not write in it;
 * `already`, with the one there, if the same product (by its key) is in that list: its price
 * brought up to date if it was read now (`change`), and its picture or note if it had none; not its
 * name, nor another note, which may have been corrected.
 */
export async function addWish(
	k: Kitchen,
	userId: string,
	kid: boolean,
	personId: number,
	product: Product,
	note: string | null
): Promise<
	{ added: number } | { refused: true } | { already: number; change: PriceChange | null }
> {
	const { people } = await viewer(k, userId, kid);
	const person = people.find((p) => p.id === String(personId) && p.writes);
	if (!person) return { refused: true };
	return k.run(async (tx) => {
		const [there] = await tx
			.select()
			.from(wish)
			.where(
				and(
					eq(wish.personId, personId),
					eq(wish.productKey, product.productKey),
					// Bought by the one adding it, it may be wanted again; by another, it may be a surprise.
					or(isNull(wish.boughtOn), isNull(wish.boughtBy), ne(wish.boughtBy, userId))
				)
			);
		if (there) {
			// Bought: as it was noted. Not so for the person it is for, who must not learn it was.
			if (there.boughtOn && !person.me) return { already: there.id, change: null };
			const now =
				product.priceCents === null
					? null
					: { cents: product.priceCents, currency: product.currency };
			const rank = (s: PriceSource) => PRICE_SOURCES.indexOf(s);
			// By hand, or by the bookmark: not replaced by what the page says to the server.
			const source = product.priceSource ?? 'servidor';
			const kept = there.priceCents !== null && rank(source) < rank(there.priceSource);
			// Its shipping, in the currency its price ends in; one not read now, kept as it was, unless
			// the price changes its currency.
			const currency = now && !kept ? now.currency : there.currency;
			const sameMoney = sameCurrency(there.currency, currency);
			const wasSent = sameMoney ? there.shippingCents : null;
			const sent =
				product.shippingCents != null &&
				(product.priceCents === null || sameCurrency(product.currency, currency))
					? product.shippingCents
					: null;
			const keptSent = wasSent !== null && rank(source) < rank(there.shippingSource);
			const set = {
				...(sent !== null && !keptSent
					? { shippingCents: sent, shippingSource: source }
					: sameMoney
						? {}
						: { shippingCents: null, shippingSource: 'servidor' as const }),
				...(now && !kept
					? {
							priceCents: now.cents,
							currency: now.currency,
							priceSource: source,
							priceAt: new Date()
						}
					: {}),
				...(!there.note && note?.trim() ? { note: note.trim().slice(0, MAX_WISH_NOTE) } : {}),
				...(!there.imageUrl && product.imageUrl ? { imageUrl: product.imageUrl } : {})
			};
			if (Object.keys(set).length) await tx.update(wish).set(set).where(eq(wish.id, there.id));
			return {
				already: there.id,
				change: now && {
					before:
						there.priceCents === null
							? null
							: { cents: there.priceCents, currency: there.currency },
					now,
					...(kept ? { kept } : {}),
					...(sent !== null
						? { shipping: { before: wasSent, now: sent, ...(keptSent ? { kept: true } : {}) } }
						: {})
				}
			};
		}
		const [made] = await tx
			.insert(wish)
			.values({
				familyId: k.familyId,
				personId,
				...product,
				shippingSource: product.priceSource ?? 'servidor',
				title: product.title.slice(0, MAX_WISH_TITLE),
				priceAt: product.priceCents !== null ? new Date() : null,
				note: note?.trim().slice(0, MAX_WISH_NOTE) || null,
				addedBy: userId
			})
			.returning({ id: wish.id });
		return { added: made!.id };
	});
}

/** Its name, note, price and shipping (not said, as it was; null, none) corrected; false if it is not there or not theirs to write. */
export async function updateWish(
	k: Kitchen,
	userId: string,
	kid: boolean,
	id: number,
	change: {
		title: string;
		note: string | null;
		price?: Price | null;
		/** In its price's currency. */
		shipping?: number | null;
	}
) {
	const personId = await wishPerson(k, id);
	if (personId === null || !(await writesIn(k, userId, kid, personId))) return false;
	const title = change.title.trim().slice(0, MAX_WISH_TITLE);
	if (!title) return false;
	const { price, shipping } = change;
	await k.run(async (tx) => {
		const [w] = await tx.select().from(wish).where(eq(wish.id, id));
		// The same one sent back with the form: still said by who said it, then.
		const same =
			price === undefined ||
			(price === null ? w?.priceCents === null : price.cents === w?.priceCents);
		await tx
			.update(wish)
			.set({
				title,
				note: change.note?.trim().slice(0, MAX_WISH_NOTE) || null,
				...(shipping === undefined || shipping === w?.shippingCents
					? {}
					: {
							shippingCents: shipping,
							shippingSource: shipping === null ? ('servidor' as const) : ('mano' as const)
						}),
				...(same
					? {}
					: {
							priceCents: price?.cents ?? null,
							currency: price?.currency ?? null,
							priceSource: price ? ('mano' as const) : ('servidor' as const),
							priceAt: price ? new Date() : null
						})
			})
			.where(eq(wish.id, id));
	});
	return true;
}

/** For when it is; false if it is not there or not theirs to write. */
export async function setWishPriority(
	k: Kitchen,
	userId: string,
	kid: boolean,
	id: number,
	priority: WishPriority
) {
	const personId = await wishPerson(k, id);
	if (personId === null || !(await writesIn(k, userId, kid, personId))) return false;
	await k.run((tx) => tx.update(wish).set({ priority }).where(eq(wish.id, id)));
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
			.where(
				and(
					eq(wish.id, id),
					isNull(wish.boughtOn),
					on ? isNull(wish.giftBy) : eq(wish.giftBy, userId)
				)
			)
			.returning({ id: wish.id })
	);
	return Boolean(done);
}

/** What «Comprado» needs of a wish; null if it is not there or not theirs to buy. */
export async function buyableWish(k: Kitchen, userId: string, kid: boolean, id: number) {
	const { people } = await viewer(k, userId, kid);
	const [w] = await k.run((tx) => tx.select().from(wish).where(eq(wish.id, id)));
	const person = people.find((p) => p.id === String(w?.personId));
	if (!w || !person || !mayBuy(w, userId, kid, person)) return null;
	return {
		title: w.title,
		mine: person.me,
		/** Another adult's: its name is not said in Dinero, which they see. */
		secret: !person.me && !person.kid
	};
}

/**
 * «Comprado», the day `on`: for another, it is their gift. False if it cannot be, or someone was
 * first.
 */
export async function buyWish(k: Kitchen, userId: string, kid: boolean, id: number, on: string) {
	const found = await buyableWish(k, userId, kid, id);
	if (!found) return false;
	const [done] = await k.run((tx) =>
		tx
			.update(wish)
			.set({
				boughtOn: on,
				boughtBy: userId,
				expenseId: null,
				...(found.mine ? {} : { giftBy: userId })
			})
			.where(
				and(
					eq(wish.id, id),
					// One's own may be bought in secret by another: theirs counts.
					found.mine
						? undefined
						: and(isNull(wish.boughtOn), or(isNull(wish.giftBy), eq(wish.giftBy, userId)))
				)
			)
			.returning({ id: wish.id })
	);
	return Boolean(done);
}

/** What it is in Dinero. */
export async function setWishExpense(k: Kitchen, userId: string, id: number, expenseId: number) {
	await k.run((tx) =>
		tx
			.update(wish)
			.set({ expenseId })
			.where(and(eq(wish.id, id), eq(wish.boughtBy, userId)))
	);
}

/** «Deshacer», by who bought it: back in the list. Its expense stays in Dinero. */
export async function unbuyWish(k: Kitchen, userId: string, id: number) {
	const [done] = await k.run((tx) =>
		tx
			.update(wish)
			.set({ boughtOn: null, boughtBy: null, expenseId: null })
			.where(and(eq(wish.id, id), eq(wish.boughtBy, userId)))
			.returning({ id: wish.id })
	);
	return Boolean(done);
}

/** Wishes said to the AI, at most: what is wanted first, the newest. */
const SAID_WISHES = 80;

/**
 * The wishes as Preguntar is told of them (#586): as the one asking may see them, so their own
 * «Lo regalo yo» stays hidden from them too. `person`, by name; `shop`, by its name.
 */
export async function describeWishes(
	k: Kitchen,
	userId: string,
	filter: { person?: string | null; shop?: string | null } = {}
) {
	const { people, wishes } = await listWishes(k, userId, false);
	const same = (a: string, b: string) =>
		a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0 ||
		a.toLowerCase().includes(b.toLowerCase());
	const asked = filter.person?.trim();
	const who = asked
		? people.filter((p) => same(p.name, asked) || (p.me && /^(yo|m[ií])$/i.test(asked)))
		: people;
	if (asked && !who.length)
		return `No hay nadie llamado «${asked}» en la familia. Personas: ${people.map((p) => p.name).join(', ')}.`;
	const ids = new Set(who.map((p) => p.id));
	const shop = filter.shop?.trim();
	const found = wishes.filter((w) => ids.has(w.personId) && (!shop || same(w.shop, shop)));
	if (!found.length) return 'No hay ningún deseo así en la lista.';
	const nameOf = new Map(people.map((p) => [p.id, p.me ? `${p.name} (quien pregunta)` : p.name]));
	const order = (w: WishView) => WISH_PRIORITIES.indexOf(w.priority);
	return found
		.sort((a, b) => Number(Boolean(a.bought)) - Number(Boolean(b.bought)) || order(a) - order(b))
		.slice(0, SAID_WISHES)
		.map((w) => {
			const seen = seenOn(w.priceAt);
			const price = costText(w);
			const priced = price ? `, ${price}${seen ? ` visto ${seen}` : ''}` : ', sin precio';
			const gift = w.gift
				? w.gift.mine
					? '; lo regala quien pregunta'
					: `; lo regala ${w.gift.name}`
				: '';
			const when = w.bought ? '' : `; para: «${WISH_PRIORITY_LABELS[w.priority]}»`;
			const bought = w.bought
				? `; comprado el ${w.bought.on} por ${w.bought.mine ? 'quien pregunta' : w.bought.name}`
				: '';
			return `${nameOf.get(w.personId)}: «${w.title}» (${w.shop}${priced})${w.note ? `, nota: ${w.note}` : ''}${when}${gift}${bought}`;
		})
		.join('\n');
}

/** The name of a person of the family, for what Preguntar is told is open. */
export async function wishPersonName(k: Kitchen, userId: string, personId: string) {
	const { people } = await listWishes(k, userId, false);
	return people.find((p) => p.id === personId)?.name ?? null;
}

export const PROPOSE_WISH: Tool = {
	type: 'function',
	function: {
		name: 'propose_wish',
		description:
			'Enseña una tarjeta para añadir a la lista de deseos (Deseos) un producto del que la persona ha pegado el enlace en el chat; Seilide lee la página y la persona lo añade con un toque. Solo con un enlace que ella haya dado, nunca uno inventado. Para su lista o la de un peque; en la de otro adulto no se puede.',
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'El enlace del producto, tal cual lo pegó.' },
				person: {
					type: 'string',
					description: 'Para quién, por su nombre. Vacío, para quien pregunta.'
				}
			},
			required: ['url'],
			additionalProperties: false
		}
	}
};

/** `propose_wish`: the product read, for a list the one asking writes in; what is wrong, in words. */
export async function proposeWish(
	k: Kitchen,
	userId: string,
	args: Record<string, unknown>
): Promise<{ result: string; card?: WishCard }> {
	const link = linkOf(args.url);
	if (!link) return { result: 'Eso no es un enlace: pídele que lo pegue.' };
	const { people } = await listWishes(k, userId, false);
	const writable = people.filter((p) => p.writes);
	const asked = typeof args.person === 'string' ? args.person.trim() : '';
	const person = asked
		? (writable.find((p) => p.name.localeCompare(asked, 'es', { sensitivity: 'base' }) === 0) ??
			writable.find((p) => p.name.toLowerCase().includes(asked.toLowerCase())))
		: writable.find((p) => p.me);
	if (!person)
		return {
			result: asked
				? `En la lista de «${asked}» no puede añadir. Puede en la de: ${writable.map((p) => p.name).join(', ')}.`
				: 'No tiene lista de deseos todavía.'
		};
	const product = await readProduct(link, null);
	const price = costText(product);
	return {
		result: `Tarjeta enseñada: «${product.title}» (${product.shop}${price ? `, ${price}` : ', sin precio'}) para la lista de ${person.me ? 'quien pregunta' : person.name}. La persona la añade con un toque; no digas que está añadido.`,
		card: {
			kind: 'deseo',
			...product,
			personId: person.id,
			personName: person.name,
			added: null,
			already: null
		}
	};
}

/** What the AI is told of a wish card later. */
export const wishLine = (c: WishCard) =>
	`[Tarjeta de deseo: «${c.title}» (${c.shop}) para la lista de ${c.personName}: ${c.added ? 'añadido' : c.already ? 'ya estaba en la lista' : 'sin añadir'}]`;

/** «Añadir» on a wish card: into that list, once; the card as it is then, or why not. */
export async function addWishFromCard(
	k: Kitchen,
	userId: string,
	card: WishCard
): Promise<{ card: WishCard } | { problem: string }> {
	if (card.added || card.already) return { card };
	const done = await addWish(
		k,
		userId,
		false,
		Number(card.personId),
		{
			url: card.url,
			productKey: card.productKey,
			shop: card.shop,
			title: card.title,
			imageUrl: card.imageUrl,
			priceCents: card.priceCents,
			currency: card.currency,
			shippingCents: card.shippingCents ?? null
		},
		null
	);
	if ('refused' in done) return { problem: 'En esa lista no puedes añadir' };
	return {
		card: {
			...card,
			added: 'added' in done ? done.added : null,
			already: 'already' in done ? done.already : null,
			change: 'already' in done ? done.change : null
		}
	};
}

/**
 * What the computer's bookmark read in the person's own browser (lib/wishes.ts bookmarklet):
 * `url`, `titulo`, `precio`, `envio` and `foto`, checked. Null without a link and a name: then the page is
 * read here, as for a link shared from a phone.
 */
export function productFromBrowser(get: (name: string) => string | null): Product | null {
	const link = linkOf(get('url'));
	const title = tidyTitle((get('titulo') ?? '').replace(/\s+/g, ' ').trim());
	if (!link || !title || onlySiteName(title, link)) return null;
	const kept = cleanLink(link);
	const price = priceFromText(get('precio'));
	const shipping = shippingFromText(get('envio'));
	return {
		url: kept.url,
		productKey: kept.key,
		shop: shopOf(link),
		title,
		imageUrl: imageOf(get('foto'), link),
		priceCents: price?.cents ?? null,
		currency: price?.currency ?? null,
		// Of another currency than its price's: not added to it.
		shippingCents:
			shipping && (!shipping.currency || sameCurrency(shipping.currency, price?.currency ?? null))
				? shipping.cents
				: null,
		priceSource: 'marcador'
	};
}
