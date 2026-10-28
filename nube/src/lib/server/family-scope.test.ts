import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, house, user } from './db/schema.ts';
import { familyScope, NoFamily } from './family-scope.ts';

/**
 * Row-level security (family.schema.ts) on a real Postgres (PGlite, in memory), with the
 * migrations as they are. PGlite enters as a superuser, whom it does not apply to: the families'
 * part runs as `app_user`, a role like production's `nube_app`.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });

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
