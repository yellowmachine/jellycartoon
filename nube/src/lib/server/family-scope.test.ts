import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import {
	family,
	familyMember,
	familySettings,
	fridgeItem,
	fridgeNote,
	house,
	houseKey,
	recipe,
	recipeSite,
	recipeSitePage,
	user
} from './db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from './family-scope.ts';
import { hashOf, houseKeyScope, newHouseKey } from './house-key-scope.ts';

/**
 * Row-level security (family.schema.ts) on a real Postgres (PGlite, in memory), with the
 * migrations as they are. PGlite enters as a superuser, whom it does not apply to: the families'
 * part runs as `app_user`, a role like production's `nube_app`.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });

/** As the app's role, but without `withFamily`: as a query that forgot it. */
const asAppOnly = <T>(fn: (tx: typeof db) => Promise<T>) =>
	db.transaction(async (tx) => {
		await tx.execute(sql`set local role app_user`);
		return fn(tx as unknown as typeof db);
	});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	// Its own migrations, wherever the tests are run from.
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);

	await db.insert(user).values(['ana', 'alberto', 'berta', 'nadie'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
	await db.insert(house).values([
		{ familyId: 'A', url: 'https://a.test', key: 'clave-a' },
		{ familyId: 'B', url: 'https://b.test', key: 'clave-b' }
	]);
});

describe('each family sees only its own rows', () => {
	test('its house', async () => {
		const rows = await withFamily('ana', (tx) => tx.select().from(house));
		expect(rows.map((r) => r.familyId)).toEqual(['A']);
	});

	test('its family', async () => {
		const rows = await withFamily('berta', (tx) => tx.select().from(family));
		expect(rows.map((r) => r.id)).toEqual(['B']);
	});

	test('its people, not the others', async () => {
		const rows = await withFamily('alberto', (tx) => tx.select().from(familyMember));
		expect(rows.map((r) => r.userId).sort()).toEqual(['alberto', 'ana']);
	});

	test('its membership and role', async () => {
		const membership = await withFamily('ana', async (_, m) => m);
		expect(membership).toEqual({ familyId: 'A', role: 'admin' });
	});
});

describe('nor can it touch another family', () => {
	test('writing a row for another', async () => {
		await expect(
			withFamily('ana', (tx) => tx.insert(familyMember).values({ userId: 'nadie', familyId: 'B' }))
		).rejects.toThrow();
	});

	test('changing another’s house', async () => {
		await withFamily('ana', (tx) =>
			tx.update(house).set({ url: 'https://robada.test' }).where(eq(house.familyId, 'B'))
		);
		const [b] = await db.select().from(house).where(eq(house.familyId, 'B'));
		expect(b.url).toBe('https://b.test');
	});

	test('moving its own house to another', async () => {
		await expect(
			withFamily('ana', (tx) =>
				tx.update(house).set({ familyId: 'B' }).where(eq(house.familyId, 'A'))
			)
		).rejects.toThrow();
	});

	test('deleting another’s', async () => {
		await withFamily('ana', (tx) => tx.delete(family).where(eq(family.id, 'B')));
		expect(await db.select().from(family).where(eq(family.id, 'B'))).toHaveLength(1);
	});
});

describe('outside withFamily', () => {
	test('a query that forgot it gets nothing', async () => {
		expect(await asAppOnly((tx) => tx.select().from(house))).toHaveLength(0);
		expect(await asAppOnly((tx) => tx.select().from(familyMember))).toHaveLength(0);
	});

	test('someone without a family is refused', async () => {
		await expect(withFamily('nadie', async () => 'dentro')).rejects.toBeInstanceOf(NoFamily);
	});

	test('the next transaction starts with nothing', async () => {
		await withFamily('ana', (tx) => tx.select().from(house));
		expect(await asAppOnly((tx) => tx.select().from(house))).toHaveLength(0);
	});
});

describe('as a family, without a person (its house)', () => {
	test('only that family’s rows', async () => {
		const rows = await asFamily('B', (tx) => tx.select().from(house));
		expect(rows.map((r) => r.familyId)).toEqual(['B']);
	});

	test('nor can it write another’s', async () => {
		await expect(
			asFamily('B', (tx) => tx.insert(house).values({ familyId: 'A', url: 'x', key: 'y' }))
		).rejects.toThrow();
	});
});

describe('the kitchen, also each family’s', () => {
	beforeAll(async () => {
		const [a] = await db
			.insert(fridgeNote)
			.values({ familyId: 'A', kind: 'list', text: 'Lista' })
			.returning();
		await db.insert(fridgeItem).values({ familyId: 'A', noteId: a.id, text: 'leche' });
		await db.insert(fridgeNote).values({ familyId: 'B', text: 'Llamar al fontanero' });
		await db.insert(recipe).values({
			familyId: 'B',
			title: 'Macarrones',
			steps: [],
			sourceUrl: 'https://recetas.test/macarrones',
			sourceName: 'recetas.test'
		});
		await db.insert(familySettings).values({ familyId: 'B', openrouterKey: 'cifrada' });
	});

	test('the fridge', async () => {
		expect(await withFamily('ana', (tx) => tx.select().from(fridgeItem))).toHaveLength(1);
		expect(await withFamily('berta', (tx) => tx.select().from(fridgeItem))).toHaveLength(0);
		const notes = await withFamily('ana', (tx) => tx.select().from(fridgeNote));
		expect(notes.map((n) => n.familyId)).toEqual(['A']);
	});

	test('the recipes and the settings', async () => {
		expect(await withFamily('ana', (tx) => tx.select().from(recipe))).toHaveLength(0);
		expect(await withFamily('ana', (tx) => tx.select().from(familySettings))).toHaveLength(0);
		expect(await withFamily('berta', (tx) => tx.select().from(recipe))).toHaveLength(1);
	});

	test('an item onto another family’s list', async () => {
		const [list] = await asFamily('A', (tx) => tx.select().from(fridgeNote));
		await expect(
			asFamily('B', (tx) =>
				tx.insert(fridgeItem).values({ familyId: 'B', noteId: list.id, text: 'robado' })
			)
		).rejects.toThrow();
		expect(await db.select().from(fridgeItem)).toHaveLength(1);
	});
});

describe('the keys families give their houses', () => {
	const familyOfKey = houseKeyScope(db, { role: 'app_user' });
	const a = newHouseKey();
	const b = newHouseKey();

	beforeAll(async () => {
		await db.insert(houseKey).values([
			{ id: 'ka', familyId: 'A', name: 'Casa', hash: a.hash, start: a.start },
			{ id: 'kb', familyId: 'B', name: 'Casa', hash: b.hash, start: b.start }
		]);
	});

	test('only their hash is kept', () => {
		expect(a.hash).toBe(hashOf(a.key));
		expect(a.hash).not.toContain(a.key);
	});

	test('a key says its family', async () => {
		expect(await familyOfKey(a.key)).toBe('A');
		expect(await familyOfKey(b.key)).toBe('B');
	});

	test('a wrong one, none', async () => {
		expect(await familyOfKey(`${a.key}x`)).toBeNull();
		expect(await familyOfKey('casita_otra')).toBeNull();
	});

	test('used, noted', async () => {
		const [row] = await db.select().from(houseKey).where(eq(houseKey.id, 'ka'));
		expect(row.lastUsedAt).not.toBeNull();
	});

	test('a family sees only its own keys', async () => {
		const rows = await withFamily('ana', (tx) => tx.select().from(houseKey));
		expect(rows.map((r) => r.id)).toEqual(['ka']);
	});

	test('without the hash, no key is seen', async () => {
		expect(await asAppOnly((tx) => tx.select().from(houseKey))).toHaveLength(0);
	});
});

describe('the favourite recipe sites, each family’s', () => {
	beforeAll(async () => {
		const [site] = await db
			.insert(recipeSite)
			.values({ familyId: 'A', host: 'recetas.test', name: 'Recetas' })
			.returning();
		await db.insert(recipeSitePage).values({
			familyId: 'A',
			siteId: site.id,
			url: 'https://recetas.test/macarrones',
			title: 'Macarrones',
			words: ' macarrones '
		});
	});

	test('seen only by their family', async () => {
		expect(await withFamily('ana', (tx) => tx.select().from(recipeSitePage))).toHaveLength(1);
		expect(await withFamily('berta', (tx) => tx.select().from(recipeSitePage))).toHaveLength(0);
		expect(await withFamily('berta', (tx) => tx.select().from(recipeSite))).toHaveLength(0);
	});

	test('a page cannot hang from another family’s site', async () => {
		const [site] = await asFamily('A', (tx) => tx.select().from(recipeSite));
		await expect(
			asFamily('B', (tx) =>
				tx.insert(recipeSitePage).values({
					familyId: 'B',
					siteId: site.id,
					url: 'https://recetas.test/robada',
					title: 'Robada',
					words: ' robada '
				})
			)
		).rejects.toThrow();
	});
});
