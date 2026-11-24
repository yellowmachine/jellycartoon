import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, familyPerson, user, wish } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import {
	BOOKMARK_VERSION,
	bookmarklet,
	cleanLink,
	knownShop,
	priceChangeParam,
	priceChangeText,
	priceFromText,
	priceText,
	readPriceChange,
	seenOn,
	shopOf,
	wishesSummary,
	type PriceChange
} from '#lib/wishes.ts';
import type { Product } from './wishes.ts';

/** Lista de deseos (#586): shops by address, and who sees and writes what, on PGlite as the app's role. */

describe('a link and its shop', () => {
	test('known shops by their name, short links too; any other by its address', () => {
		expect(knownShop('https://www.amazon.es/dp/B0C')).toBe('Amazon');
		expect(knownShop('https://amzn.eu/d/abc')).toBe('Amazon');
		expect(knownShop('https://a.co/d/xyz')).toBe('Amazon');
		expect(knownShop('https://es.aliexpress.com/item/1.html')).toBe('AliExpress');
		expect(knownShop('https://www.ikea.com/es/es/p/billy')).toBe('IKEA');
		expect(knownShop('https://www2.hm.com/es_es/x')).toBe('H&M');
		expect(knownShop('https://www.recetasderechupete.com/x')).toBeNull();
		expect(knownShop('https://notamazon.es.example.com/')).toBeNull();
		expect(shopOf('https://www.tiendita.es/p/1')).toBe('tiendita.es');
		expect(knownShop('ftp://amazon.es/x')).toBeNull();
	});

	test('the link in what was shared, without its #; not a link, null', () => {
		expect(linkOf('Mira esto https://amzn.eu/d/abc#top y más')).toBe('https://amzn.eu/d/abc');
		expect(linkOf('sin enlace')).toBeNull();
		expect(linkOf(null)).toBeNull();
	});

	test('the name from what was shared, without the address nor the shop', () => {
		expect(titleFromShared('Amazon.es: Auriculares Sony WH-1000XM5 https://amzn.eu/d/abc')).toBe(
			'Auriculares Sony WH-1000XM5'
		);
		expect(tidyTitle('Amazon.es: Lámpara de mesa : Hogar y cocina')).toBe('Lámpara de mesa');
		expect(titleFromShared('https://amzn.eu/d/abc')).toBe('');
	});

	test('the name in Amazon’s long address; a page with only the site’s name is not one', () => {
		expect(
			titleFromAddress(
				'https://www.amazon.es/Sony-WH-1000XM5-Auriculares-Inal%C3%A1mbricos/dp/B09XS7JWHH/ref=sr_1_1?th=1'
			)
		).toBe('Sony WH 1000XM5 Auriculares Inalámbricos');
		expect(titleFromAddress('https://www.amazon.es/dp/B09XS7JWHH')).toBe('');
		expect(titleFromAddress('https://amzn.eu/d/abc')).toBe('');
		expect(onlySiteName('Amazon.es', 'https://www.amazon.es/dp/B09XS7JWHH')).toBe(true);
		expect(onlySiteName('Amazon', 'https://www.amazon.es/dp/B09XS7JWHH')).toBe(true);
		expect(onlySiteName('Auriculares Sony', 'https://www.amazon.es/dp/B09XS7JWHH')).toBe(false);
	});

	test('the address kept: Amazon’s by its ASIN, others without what only tracks', () => {
		expect(
			cleanLink(
				'https://www.amazon.es/Sony-WH-1000XM5/dp/b09xs7jwhh/ref=sr_1_1?th=1&psc=1&tag=x-21'
			)
		).toEqual({ url: 'https://www.amazon.es/dp/B09XS7JWHH', key: 'amazon:B09XS7JWHH' });
		expect(cleanLink('https://www.amazon.es/gp/product/B09XS7JWHH?smid=A1').key).toBe(
			'amazon:B09XS7JWHH'
		);
		expect(cleanLink('https://es.aliexpress.com/item/1005006.html?spm=a2g0o&algo_pvid=9')).toEqual({
			url: 'https://es.aliexpress.com/item/1005006.html',
			key: 'aliexpress:1005006'
		});
		expect(
			cleanLink(
				'https://www.ikea.com/es/es/p/billy-00263850/?utm_source=x&fbclid=y&color=blanco#top'
			)
		).toEqual({
			url: 'https://www.ikea.com/es/es/p/billy-00263850/?color=blanco',
			key: 'url:ikea.com/es/es/p/billy-00263850/?color=blanco'
		});
		expect(cleanLink('https://tienda.es/p/1?utm_campaign=z').url).toBe('https://tienda.es/p/1');
	});

	test('the day a price was seen', () => {
		expect(seenOn(new Date(2026, 10, 22, 12))).toBe('el 22 nov');
		expect(seenOn(null)).toBeNull();
	});

	test('prices as pages write them, and as Spain reads them', () => {
		expect(centsOf('29.99')).toBe(2999);
		expect(centsOf(29.9)).toBe(2990);
		expect(centsOf('29,99')).toBe(2999);
		expect(centsOf('1.299,00')).toBeNull();
		expect(centsOf('gratis')).toBeNull();
		expect(centsOf('0')).toBeNull();
		expect(priceText(2999, 'EUR')?.replace(/\s/g, ' ')).toBe('29,99 €');
		expect(priceText(null, 'EUR')).toBeNull();
	});
});

const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
// The agenda's people read through the app's database: this one.
mock.module('#lib/server/db/index.ts', () => ({ db }));
// What the agenda brings and the wishes never use: no one is told anything here.
mock.module('#lib/server/inbox.ts', () => ({ tell: async () => {} }));
mock.module('#lib/server/telegram/bot.ts', () => ({ tellGroup: async () => {} }));
const {
	addWish,
	buyableWish,
	buyWish,
	unbuyWish,
	centsOf,
	addWishFromCard,
	deleteWish,
	describeWishes,
	productFromBrowser,
	proposeWish,
	giveWish,
	linkOf,
	listWishes,
	onlySiteName,
	titleFromAddress,
	titleFromShared,
	tidyTitle,
	setWishPriority,
	updateWish
} = await import('./wishes.ts');
const kitchen = (userId: string, familyId = 'A'): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana');
const pepe = kitchen('pepe');
const lucia = kitchen('lucia');
const otro = kitchen('otro', 'B');
const people: Record<string, number> = {};

let made = 0;
/** A different product each time, unless said. */
const product = (title = 'Auriculares', productKey = `amazon:B0C${++made}`): Product => ({
	url: 'https://www.amazon.es/dp/B0C',
	productKey,
	shop: 'Amazon',
	title,
	imageUrl: null,
	priceCents: 2999,
	currency: 'EUR'
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(user).values(
		['ana', 'pepe', 'lucia', 'otro'].map((id) => ({
			id,
			name: id[0]!.toUpperCase() + id.slice(1),
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pepe', familyId: 'A', role: 'member' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	const rows = await db
		.insert(familyPerson)
		.values([
			{ familyId: 'A', userId: 'ana', name: 'Ana' },
			{ familyId: 'A', userId: 'pepe', name: 'Pepe' },
			{ familyId: 'A', userId: 'lucia', name: 'Lucía' },
			{ familyId: 'A', name: 'Bebé' },
			{ familyId: 'B', userId: 'otro', name: 'Otro' }
		])
		.returning();
	for (const r of rows) people[r.name] = r.id;
});

beforeEach(async () => {
	await db.delete(wish);
});

const titles = async (k: Kitchen, userId: string, kid = false) =>
	(await listWishes(k, userId, kid)).wishes.map((w) => w.title).sort();

describe('whose list', () => {
	test('an adult writes in their own and the children’s, not in another adult’s', async () => {
		expect(await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null)).toHaveProperty(
			'added'
		);
		expect(
			await addWish(ana, 'ana', false, people.Bebé!, product('Del bebé'), null)
		).toHaveProperty('added');
		expect(
			await addWish(ana, 'ana', false, people.Lucía!, product('De Lucía'), null)
		).toHaveProperty('added');
		expect(await addWish(ana, 'ana', false, people.Pepe!, product('De Pepe'), null)).toEqual({
			refused: true
		});
		// The whole family sees them.
		expect(await titles(pepe, 'pepe')).toEqual(['De Ana', 'De Lucía', 'Del bebé']);
	});

	test('a child sees and writes only in its own', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		expect(
			await addWish(lucia, 'lucia', true, people.Lucía!, product('Bici'), null)
		).toHaveProperty('added');
		expect(await addWish(lucia, 'lucia', true, people.Bebé!, product('Otra'), null)).toEqual({
			refused: true
		});
		expect(await titles(lucia, 'lucia', true)).toEqual(['Bici']);
		const { people: seen } = await listWishes(lucia, 'lucia', true);
		// Its account's name.
		expect(seen.map((p) => p.name)).toEqual(['Lucia']);
	});

	test('another family sees none of them', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		expect(await titles(otro, 'otro')).toEqual([]);
		expect(await addWish(otro, 'otro', false, people.Ana!, product('Colado'), null)).toEqual({
			refused: true
		});
	});

	test('corrected and removed only by who writes in that list', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		const [w] = (await listWishes(ana, 'ana', false)).wishes;
		expect(await updateWish(pepe, 'pepe', false, w!.id, { title: 'Otro', note: null })).toBe(false);
		expect(await deleteWish(pepe, 'pepe', false, w!.id)).toBe(false);
		expect(
			await updateWish(ana, 'ana', false, w!.id, { title: 'Auriculares negros', note: 'Talla M' })
		).toBe(true);
		expect((await listWishes(pepe, 'pepe', false)).wishes[0]).toMatchObject({
			title: 'Auriculares negros',
			note: 'Talla M'
		});
		expect(await deleteWish(ana, 'ana', false, w!.id)).toBe(true);
		expect(await titles(ana, 'ana')).toEqual([]);
	});
});

describe('the same product again', () => {
	test('told it is there, in that person’s list only; its price with the day it was seen', async () => {
		const first = await addWish(
			ana,
			'ana',
			false,
			people.Ana!,
			product('Sony', 'amazon:B09'),
			null
		);
		expect(first).toHaveProperty('added');
		expect(
			await addWish(ana, 'ana', false, people.Ana!, product('Sony otra vez', 'amazon:B09'), null)
		).toEqual({
			already: (first as { added: number }).added,
			change: {
				before: { cents: 2999, currency: 'EUR' },
				now: { cents: 2999, currency: 'EUR' }
			}
		});
		// For someone else, it is another wish.
		expect(
			await addWish(ana, 'ana', false, people.Bebé!, product('Sony', 'amazon:B09'), null)
		).toHaveProperty('added');
		const mine = (await listWishes(ana, 'ana', false)).wishes.filter(
			(w) => w.personId === String(people.Ana)
		);
		expect(mine.map((w) => w.title)).toEqual(['Sony']);
		expect(mine[0]!.priceAt).toBeInstanceOf(Date);
		const noPrice = await addWish(
			ana,
			'ana',
			false,
			people.Ana!,
			{ ...product('Sin precio'), priceCents: null },
			null
		);
		const row = (await listWishes(ana, 'ana', false)).wishes.find(
			(w) => w.id === (noPrice as { added: number }).added
		);
		expect(row!.priceAt).toBeNull();
	});
});

describe('added again: its price', () => {
	const at = (priceCents: number | null, imageUrl: string | null = null) => ({
		...product('Juego', 'url:steam/1'),
		priceCents,
		imageUrl
	});
	const add = (p: Product, who: [Kitchen, string] = [ana, 'ana'], person = people.Ana!) =>
		addWish(who[0], who[1], false, person, p, null);
	const one = async () => (await listWishes(ana, 'ana', false)).wishes[0]!;

	test('brought up to date, or kept if not read; the picture if it had none', async () => {
		await add(at(null));
		expect(await add(at(1999, 'https://x.es/a.jpg'))).toMatchObject({
			change: { before: null, now: { cents: 1999 } }
		});
		expect(await add(at(1399, 'https://x.es/b.jpg'))).toMatchObject({
			change: { before: { cents: 1999 }, now: { cents: 1399 } }
		});
		expect(await add(at(null))).toMatchObject({ change: null });
		expect(await one()).toMatchObject({ priceCents: 1399, imageUrl: 'https://x.es/a.jpg' });
	});

	test('a note if it had none; another one, kept', async () => {
		const noted = (note: string | null) => addWish(ana, 'ana', false, people.Ana!, at(1999), note);
		await noted(null);
		await noted('De segunda mano');
		expect((await one()).note).toBe('De segunda mano');
		await noted('Otra');
		expect((await one()).note).toBe('De segunda mano');
	});

	test('bought by another: kept as it was, but for who it is for, who must not notice', async () => {
		await add(at(1999), [ana, 'ana'], people['Bebé']!);
		await buyWish(ana, 'ana', false, (await one()).id, '2026-11-24');
		expect(await add(at(1399), [pepe, 'pepe'], people['Bebé']!)).toMatchObject({ change: null });
		await db.delete(wish);
		await add(at(1999));
		const { id } = await one();
		await giveWish(pepe, 'pepe', false, id, true);
		await buyWish(pepe, 'pepe', false, id, '2026-11-24');
		expect(await add(at(1399))).toMatchObject({
			already: id,
			change: { before: { cents: 1999 }, now: { cents: 1399 } }
		});
	});

	test('by the bookmark or by hand: not replaced by what the server reads', async () => {
		const marked = (cents: number) => ({ ...at(cents), priceSource: 'marcador' as const });
		await add(at(5854));
		await add(marked(8420));
		expect(await add(at(5854))).toMatchObject({
			change: { before: { cents: 8420 }, now: { cents: 5854 }, kept: true }
		});
		expect((await one()).priceCents).toBe(8420);
		await add(marked(9000));
		const { id } = await one();
		const edit = (price?: { cents: number; currency: string } | null) =>
			updateWish(ana, 'ana', false, id, { title: 'Lámina', note: '55 cm', price });
		// The form sent back as it was: still the bookmark's.
		await edit({ cents: 9000, currency: 'EUR' });
		await add(marked(9100));
		expect((await one()).priceCents).toBe(9100);
		await edit({ cents: 7500, currency: 'EUR' });
		expect(await add(marked(9100))).toMatchObject({ change: { kept: true } });
		expect((await one()).priceCents).toBe(7500);
		await edit();
		expect((await one()).priceCents).toBe(7500);
		// Taken out: the next one read counts.
		await edit(null);
		expect((await one()).priceCents).toBeNull();
		await add(at(5854));
		expect((await one()).priceCents).toBe(5854);
	});

	test('in words, and through an address', () => {
		const said = (c: PriceChange) => priceChangeText(c).replace(/\s/g, ' ');
		const eur = (cents: number) => ({ cents, currency: 'EUR' });
		expect(said({ before: eur(1999), now: eur(1399) })).toBe(
			'precio actualizado, de 19,99 € a 13,99 €'
		);
		expect(said({ before: eur(1399), now: eur(1399) })).toBe('sigue a 13,99 €');
		expect(said({ before: null, now: eur(1399) })).toBe('ahora con precio, 13,99 €');
		expect(said({ before: eur(8420), now: eur(5854), kept: true })).toBe(
			'ahora se lee 58,54 €; se queda en 84,20 €'
		);
		for (const c of [
			{ before: eur(1999), now: eur(1399) },
			{ before: null, now: { cents: 5, currency: null } },
			{ before: eur(8420), now: eur(5854), kept: true }
		])
			expect(readPriceChange(priceChangeParam(c))).toEqual(c);
		expect(readPriceChange('<b>')).toBeNull();
	});
});

test('what a list has, and what it costs', () => {
	const w = (priceCents: number | null, currency: string | null = 'EUR') => ({
		priceCents,
		currency
	});
	const said = (...list: ReturnType<typeof w>[]) => wishesSummary(list).replace(/\s/g, ' ');
	expect(wishesSummary([], 8)).toBe('0 de 8 productos');
	expect(wishesSummary([w(1000)], 8).replace(/\s/g, ' ')).toBe('1 de 8 productos · 10,00 €');
	expect(said(w(null))).toBe('1 producto · sin precio');
	expect(said(w(1000), w(250, null))).toBe('2 productos · 12,50 €');
	expect(said(w(1000), w(null), w(500, 'GBP'))).toBe(
		'3 productos · 2 con precio, 10,00 € + 5,00 GBP'
	);
});

describe('«Lo regalo yo»', () => {
	test('seen by everyone but the person it is for', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		const [w] = (await listWishes(ana, 'ana', false)).wishes;
		expect(await giveWish(pepe, 'pepe', false, w!.id, true)).toBe(true);
		expect((await listWishes(pepe, 'pepe', false)).wishes[0]!.gift).toEqual({
			mine: true,
			name: 'Pepe'
		});
		// Ana, whose wish it is, does not know.
		expect((await listWishes(ana, 'ana', false)).wishes[0]!.gift).toBeNull();
	});

	test('not one’s own, not over another’s, not by a child; given up only by who gives it', async () => {
		await addWish(ana, 'ana', false, people.Bebé!, product('Del bebé'), null);
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		const { wishes } = await listWishes(ana, 'ana', false);
		const baby = wishes.find((w) => w.title === 'Del bebé')!;
		const own = wishes.find((w) => w.title === 'De Ana')!;
		expect(await giveWish(ana, 'ana', false, own.id, true)).toBe(false);
		expect(await giveWish(lucia, 'lucia', true, baby.id, true)).toBe(false);
		expect(await giveWish(ana, 'ana', false, baby.id, true)).toBe(true);
		expect(await giveWish(pepe, 'pepe', false, baby.id, true)).toBe(false);
		expect(await giveWish(pepe, 'pepe', false, baby.id, false)).toBe(false);
		expect(
			(await listWishes(pepe, 'pepe', false)).wishes.find((w) => w.id === baby.id)!.gift
		).toEqual({ mine: false, name: 'Ana' });
		expect(await giveWish(ana, 'ana', false, baby.id, false)).toBe(true);
		expect(
			(await listWishes(pepe, 'pepe', false)).wishes.find((w) => w.id === baby.id)!.gift
		).toBeNull();
	});
});

describe('«Comprado»', () => {
	const seen = async (k: Kitchen, who: string, kid = false) =>
		(await listWishes(k, who, kid)).wishes[0]!;

	test('a child’s: it is the buyer’s gift, and the child does not know', async () => {
		await addWish(ana, 'ana', false, people.Lucía!, product('Bici'), null);
		const { id } = await seen(ana, 'ana');
		expect(await buyableWish(ana, 'ana', false, id)).toEqual({
			title: 'Bici',
			mine: false,
			secret: false
		});
		expect(await buyWish(lucia, 'lucia', true, id, '2026-11-24')).toBe(false);
		expect(await buyWish(ana, 'ana', false, id, '2026-11-24')).toBe(true);
		expect(await seen(pepe, 'pepe')).toMatchObject({
			bought: { mine: false, name: 'Ana', on: '2026-11-24' },
			gift: { mine: false, name: 'Ana' },
			buys: false
		});
		expect(await seen(lucia, 'lucia', true)).toMatchObject({ bought: null, gift: null });
		expect(await buyWish(pepe, 'pepe', false, id, '2026-11-24')).toBe(false);
		// Not given up while bought; undone only by who bought it.
		expect(await giveWish(ana, 'ana', false, id, false)).toBe(false);
		expect(await unbuyWish(pepe, 'pepe', id)).toBe(false);
		expect(await unbuyWish(ana, 'ana', id)).toBe(true);
		expect((await seen(ana, 'ana')).bought).toBeNull();
	});

	test('another adult’s: only by who gives it, in secret', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('Reloj', 'reloj'), null);
		const { id } = await seen(pepe, 'pepe');
		expect(await buyWish(pepe, 'pepe', false, id, '2026-11-24')).toBe(false);
		await giveWish(pepe, 'pepe', false, id, true);
		expect((await buyableWish(pepe, 'pepe', false, id))!.secret).toBe(true);
		expect(await buyWish(pepe, 'pepe', false, id, '2026-11-24')).toBe(true);
		expect(await seen(ana, 'ana')).toMatchObject({ bought: null, gift: null, buys: true });
		expect(await describeWishes(ana, 'ana')).not.toContain('comprado');
		expect(await describeWishes(pepe, 'pepe')).toContain('comprado el 2026-11-24');
		// Added again by Ana, it is there: nothing given away.
		expect(
			await addWish(ana, 'ana', false, people.Ana!, product('Reloj', 'reloj'), null)
		).toMatchObject({
			already: id
		});
		// Ana buys it herself: Pepe sees it.
		expect(await buyWish(ana, 'ana', false, id, '2026-11-25')).toBe(true);
		expect((await seen(pepe, 'pepe')).bought).toMatchObject({ mine: false, name: 'Ana' });
	});

	test('one’s own: seen as bought, and may be wanted again', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('Libro', 'libro'), null);
		const { id } = await seen(ana, 'ana');
		expect(await buyWish(otro, 'otro', false, id, '2026-11-24')).toBe(false);
		expect(await buyWish(ana, 'ana', false, id, '2026-11-24')).toBe(true);
		expect(await seen(ana, 'ana')).toMatchObject({
			bought: { mine: true, on: '2026-11-24' },
			gift: null,
			buys: false
		});
		expect(
			await addWish(ana, 'ana', false, people.Ana!, product('Libro', 'libro'), null)
		).toHaveProperty('added');
	});
});

describe('for when', () => {
	test('set by who writes in the list, seen by the family; Preguntar is told what is first', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('Libro'), null);
		await addWish(ana, 'ana', false, people.Ana!, product('Cámara'), null);
		await addWish(ana, 'ana', false, people.Ana!, product('Bici'), null);
		const all = (await listWishes(ana, 'ana', false)).wishes;
		const id = (title: string) => all.find((w) => w.title === title)!.id;
		expect(all.every((w) => w.priority === 'pronto')).toBe(true);
		expect(await setWishPriority(pepe, 'pepe', false, id('Libro'), 'primero')).toBe(false);
		expect(await setWishPriority(otro, 'otro', false, id('Libro'), 'primero')).toBe(false);
		expect(await setWishPriority(ana, 'ana', false, id('Libro'), 'primero')).toBe(true);
		expect(await setWishPriority(ana, 'ana', false, id('Bici'), 'mas_adelante')).toBe(true);
		const said = (await describeWishes(pepe, 'pepe')).split('\n');
		expect(said[0]).toContain('«Libro»');
		expect(said[0]).toContain('para: lo primero');
		expect(said[1]).toContain('«Cámara»');
		expect(said[1]).not.toContain('para:');
		expect(said[2]).toContain('para: más adelante');
	});
});

describe('what Preguntar is told', () => {
	test('by person and shop; the one asking does not learn who gives them theirs', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('Auriculares'), 'Negros');
		await addWish(
			ana,
			'ana',
			false,
			people.Bebé!,
			{ ...product('Peluche'), shop: 'IKEA', priceCents: null },
			null
		);
		const [own] = (await listWishes(ana, 'ana', false)).wishes.filter(
			(w) => w.title === 'Auriculares'
		);
		await giveWish(pepe, 'pepe', false, own!.id, true);
		const toAna = await describeWishes(ana, 'ana');
		expect(toAna).toContain('Ana (quien pregunta): «Auriculares» (Amazon, 29,99');
		expect(toAna).toContain('nota: Negros');
		expect(toAna).not.toContain('lo regala');
		expect(toAna).toContain('Bebé: «Peluche» (IKEA, sin precio)');
		expect(await describeWishes(pepe, 'pepe', { person: 'ana' })).toContain(
			'lo regala quien pregunta'
		);
		expect(await describeWishes(pepe, 'pepe', { shop: 'ikea' })).not.toContain('Auriculares');
		expect(await describeWishes(pepe, 'pepe', { person: 'Juan' })).toContain(
			'No hay nadie llamado'
		);
	});
});

describe('the card in Preguntar', () => {
	const card = (personId: number, personName: string, productKey = 'amazon:CARD1') => ({
		kind: 'deseo' as const,
		...product('Lámpara', productKey),
		personId: String(personId),
		personName,
		added: null,
		already: null
	});

	test('added once; the same product again, «ya estaba»', async () => {
		const first = await addWishFromCard(ana, 'ana', card(people.Ana!, 'Ana'));
		expect('card' in first && first.card.added).toBeGreaterThan(0);
		// Tapped again: nothing new.
		expect(await addWishFromCard(ana, 'ana', 'card' in first ? first.card : card(0, ''))).toEqual(
			first
		);
		const again = await addWishFromCard(ana, 'ana', card(people.Ana!, 'Ana'));
		expect('card' in again && again.card.already).toBe('card' in first ? first.card.added : -1);
		expect(await titles(ana, 'ana')).toEqual(['Lámpara']);
	});

	test('not into another adult’s list, nor proposed for it', async () => {
		expect(await addWishFromCard(ana, 'ana', card(people.Pepe!, 'Pepe'))).toEqual({
			problem: 'En esa lista no puedes añadir'
		});
		expect(
			(await proposeWish(ana, 'ana', { url: 'https://amzn.eu/d/x', person: 'Pepe' })).result
		).toContain('no puede añadir');
		expect((await proposeWish(ana, 'ana', { url: 'no es un enlace' })).result).toContain(
			'no es un enlace'
		);
	});
});

describe('the computer’s bookmark', () => {
	test('prices as people read them', () => {
		expect(priceFromText('29,99 €')).toEqual({ cents: 2999, currency: 'EUR' });
		expect(priceFromText('1.299,00 €')).toEqual({ cents: 129900, currency: 'EUR' });
		expect(priceFromText('$29.99')).toEqual({ cents: 2999, currency: 'USD' });
		expect(priceFromText('35 €')).toEqual({ cents: 3500, currency: 'EUR' });
		expect(priceFromText('')).toBeNull();
		expect(priceFromText('Sin stock')).toBeNull();
	});

	test('what the browser read, checked: the address clean, no picture that is not a web one', () => {
		const sent: Record<string, string> = {
			url: 'https://www.amazon.es/Sony/dp/B09XS7JWHH?th=1',
			titulo: '  Auriculares   Sony  ',
			precio: '29,99 €',
			foto: 'javascript:alert(1)'
		};
		expect(productFromBrowser((n) => sent[n] ?? null)).toEqual({
			url: 'https://www.amazon.es/dp/B09XS7JWHH',
			productKey: 'amazon:B09XS7JWHH',
			shop: 'Amazon',
			title: 'Auriculares Sony',
			imageUrl: null,
			priceCents: 2999,
			currency: 'EUR',
			priceSource: 'marcador'
		});
		// Only the site's name, or nothing: not read, the page is asked for instead.
		expect(productFromBrowser((n) => ({ ...sent, titulo: 'Amazon.es' })[n] ?? null)).toBeNull();
		expect(productFromBrowser((n) => (n === 'url' ? sent.url! : null))).toBeNull();
	});

	test('its code changed, its version too: then both here', async () => {
		const source = await Bun.file(`${import.meta.dir}/../wishes.ts`).text();
		const code = source
			.split('\n')
			.filter((l) => /^(const PAGE_TEXT = |\tconst code = )/.test(l))
			.join('\n');
		const hash = new Bun.CryptoHasher('sha256').update(code).digest('hex').slice(0, 12);
		expect({ version: BOOKMARK_VERSION, hash }).toEqual({ version: 1, hash: '2edf4d1b3479' });
	});

	test('run on an Amazon page, it opens Seilide with its name, price and picture', () => {
		const els: Record<string, unknown> = {
			'#productTitle': { textContent: '  Auriculares Sony  ' },
			'#landingImage': { dataset: { oldHires: 'https://m.media-amazon.com/x.jpg' } }
		};
		let opened = '';
		const run = new Function(
			'document',
			'location',
			'window',
			decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
		);
		run(
			{
				querySelector: (s: string) => els[s] ?? null,
				querySelectorAll: (s: string) =>
					s.startsWith('.a-price')
						? [
								{
									getClientRects: () => [{}],
									querySelector: () => ({ textContent: '29,99 €' })
								}
							]
						: [],
				title: 'Amazon.es'
			},
			{ href: 'https://www.amazon.es/dp/B09XS7JWHH?th=1' },
			{ open: (u: string) => (opened = u) }
		);
		const asked = new URL(opened);
		expect(asked.origin + asked.pathname).toBe('https://seilide.app/compartido/enlace');
		expect(Object.fromEntries(asked.searchParams)).toEqual({
			url: 'https://www.amazon.es/dp/B09XS7JWHH?th=1',
			v: String(BOOKMARK_VERSION),
			titulo: 'Auriculares Sony',
			precio: '29,99 €',
			foto: 'https://m.media-amazon.com/x.jpg'
		});
	});

	test('run on a page whose offers say no price, from its og: tags', () => {
		const meta = (n: string) => `meta[property="${n}"],meta[name="${n}"]`;
		const els: Record<string, unknown> = {
			[meta('og:price:amount')]: { content: '113.26' },
			[meta('og:price:currency')]: { content: 'GBP' }
		};
		const offers: Record<string, unknown>[] = [{ '@type': 'Offer', availability: 'InStock' }];
		const run = () => {
			let opened = '';
			new Function(
				'document',
				'location',
				'window',
				decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
			)(
				{
					querySelector: (s: string) => els[s] ?? null,
					querySelectorAll: () => [
						{ textContent: JSON.stringify({ '@type': 'Product', name: 'Camiseta', offers }) }
					],
					title: 'x'
				},
				{ href: 'https://www.nbastore.eu/es/x' },
				{ open: (u: string) => (opened = u) }
			);
			return new URL(opened).searchParams.get('precio');
		};
		expect(run()).toBe('113.26 £');
		// Not in the first offer, but in another's specification.
		offers.push({ priceSpecification: { price: 99.5, priceCurrency: 'EUR' } });
		expect(run()).toBe('99.5 €');
	});

	test('made to measure: the price in the button that adds it to the cart', () => {
		const button = (textContent: string, shown = true) => ({
			textContent,
			getClientRects: () => (shown ? [{}] : [])
		});
		const run = (buttons: unknown[]) => {
			let opened = '';
			new Function(
				'document',
				'location',
				'window',
				decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
			)(
				{
					querySelector: (s: string) =>
						s.includes('"product:price:amount"') ? { content: '58.54' } : null,
					querySelectorAll: (s: string) => (s.startsWith('button') ? buttons : []),
					title: 'Composition 8'
				},
				{ href: 'https://www.topartprint.com/x' },
				{ open: (u: string) => (opened = u) }
			);
			return new URL(opened).searchParams.get('precio');
		};
		const add = '\n  Add to Cart\n  €84.20\n';
		expect(run([button('Buscar'), button(add)])).toBe('€84.20');
		expect(run([button('Añadir a la cesta 1.084,20 €')])).toBe('1.084,20 €');
		// Another tab's, hidden; not worked out yet; or several: the page's own.
		expect(run([button('Add to Cart €99', false), button(add)])).toBe('€84.20');
		expect(run([button('Add to Cart €0')])).toBe('58.54 €');
		expect(run([button(add), button('Add to cart €12')])).toBe('58.54 €');
	});

	test('run on Steam, from its microdata', () => {
		const inside = '[itemtype*="schema.org/Product"] ';
		const els: Record<string, unknown> = {
			[`${inside}[itemprop="price"]`]: { content: '13,99' },
			[`${inside}[itemprop="priceCurrency"]`]: { content: 'EUR' }
		};
		let opened = '';
		new Function(
			'document',
			'location',
			'window',
			decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
		)(
			{
				querySelector: (s: string) => els[s] ?? null,
				querySelectorAll: () => [],
				title: 'Stardew Valley en Steam'
			},
			{ href: 'https://store.steampowered.com/app/413150/Stardew_Valley/' },
			{ open: (u: string) => (opened = u) }
		);
		expect(new URL(opened).searchParams.get('precio')).toBe('13,99 €');
	});

	test('run on Amazon, the price of the buying option chosen; second-hand, in the note', () => {
		const price = (off: string, shown: string, seen = true) => ({
			getClientRects: () => (seen ? [{}] : []),
			querySelector: (s: string) => ({ textContent: s === '.a-offscreen' ? off : shown })
		});
		const row = (id: string, title: string, prices: unknown[]) => ({
			id,
			querySelectorAll: () => prices,
			querySelector: () => ({ textContent: title })
		});
		const run = (chosen: unknown) => {
			let opened = '';
			new Function(
				'document',
				'location',
				'window',
				decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
			)(
				{
					querySelector: (s: string) => (s.includes('a-accordion-active') ? chosen : null),
					querySelectorAll: () => [],
					title: 'Libro'
				},
				{ href: 'https://www.amazon.es/dp/B09XS7JWHH' },
				{ open: (u: string) => (opened = u) }
			);
			const asked = new URL(opened).searchParams;
			return [asked.get('precio'), asked.get('nota')];
		};
		// As Amazon has it: one hidden, and the one seen blank but for its pieces.
		expect(
			run(
				row('usedAccordionRow', 'De segunda mano: buen estado', [
					price('26,83€', '26,83€', false),
					price(' ', '26,83€'),
					price('87,32 €', '87,32', false)
				])
			)
		).toEqual(['26,83€', 'De segunda mano: buen estado']);
		expect(run(row('newAccordionRow_0', 'Comprar nuevo', [price('87,32€', '87,32€')]))).toEqual([
			'87,32€',
			null
		]);
	});

	test('run on another shop, from its schema.org Product', () => {
		const ld = {
			textContent: JSON.stringify({
				'@graph': [
					{ '@type': 'WebPage' },
					{
						'@type': 'Product',
						name: 'Estantería Billy',
						image: ['https://ikea.example/billy.jpg'],
						offers: { price: '59.99', priceCurrency: 'EUR' }
					}
				]
			})
		};
		let opened = '';
		new Function(
			'document',
			'location',
			'window',
			decodeURIComponent(bookmarklet('https://seilide.app').slice('javascript:'.length))
		)(
			{ querySelector: () => null, querySelectorAll: () => [ld], title: 'Billy | IKEA' },
			{ href: 'https://www.ikea.com/es/es/p/billy-00263850/' },
			{ open: (u: string) => (opened = u) }
		);
		const read = Object.fromEntries(new URL(opened).searchParams);
		expect(read).toMatchObject({
			titulo: 'Estantería Billy',
			precio: '59.99 €',
			foto: 'https://ikea.example/billy.jpg'
		});
		expect(priceFromText(read.precio)).toEqual({ cents: 5999, currency: 'EUR' });
	});
});
