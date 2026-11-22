import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, familyPerson, user, wish } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import { knownShop, priceText, shopOf } from '#lib/wishes.ts';
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
	centsOf,
	deleteWish,
	describeWishes,
	giveWish,
	linkOf,
	listWishes,
	onlySiteName,
	titleFromAddress,
	titleFromShared,
	tidyTitle,
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

const product = (title = 'Auriculares'): Product => ({
	url: 'https://www.amazon.es/dp/B0C',
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
		expect(await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null)).toBe(true);
		expect(await addWish(ana, 'ana', false, people.Bebé!, product('Del bebé'), null)).toBe(true);
		expect(await addWish(ana, 'ana', false, people.Lucía!, product('De Lucía'), null)).toBe(true);
		expect(await addWish(ana, 'ana', false, people.Pepe!, product('De Pepe'), null)).toBe(false);
		// The whole family sees them.
		expect(await titles(pepe, 'pepe')).toEqual(['De Ana', 'De Lucía', 'Del bebé']);
	});

	test('a child sees and writes only in its own', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		expect(await addWish(lucia, 'lucia', true, people.Lucía!, product('Bici'), null)).toBe(true);
		expect(await addWish(lucia, 'lucia', true, people.Bebé!, product('Otra'), null)).toBe(false);
		expect(await titles(lucia, 'lucia', true)).toEqual(['Bici']);
		const { people: seen } = await listWishes(lucia, 'lucia', true);
		// Its account's name.
		expect(seen.map((p) => p.name)).toEqual(['Lucia']);
	});

	test('another family sees none of them', async () => {
		await addWish(ana, 'ana', false, people.Ana!, product('De Ana'), null);
		expect(await titles(otro, 'otro')).toEqual([]);
		expect(await addWish(otro, 'otro', false, people.Ana!, product('Colado'), null)).toBe(false);
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
