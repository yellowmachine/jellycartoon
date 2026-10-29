import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import { expense, expenseLine, family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** Gastos → Búsqueda on a real Postgres (PGlite, in memory), with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
/** As the app's role (`nube_app` in production), to whom row-level security applies. */
const k: Kitchen = {
	familyId: 'A',
	userId: null,
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', 'A', true)`);
			return fn(tx);
		})
};
// Bun's module mocks are the whole run's: the same as ai-costs.test.ts's.
mock.module('#lib/server/fridge.ts', () => ({ houseKitchen: () => k, today: localDay }));
mock.module('./receipt.ts', () => ({ keepReceipt: () => null, removeReceipt: () => null }));
const { searchExpenses } = await import('./expenses.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	const [mercadona] = await db
		.insert(expense)
		.values({
			familyId: 'A',
			date: '2026-10-20',
			store: 'Mercadona',
			category: 'Comida',
			total: 1250,
			source: 'mano'
		})
		.returning();
	await db.insert(expense).values({
		familyId: 'A',
		date: '2026-10-25',
		store: 'Café Central',
		category: 'Comida',
		total: 300,
		source: 'mano'
	});
	await db
		.insert(expenseLine)
		.values({ familyId: 'A', expenseId: mercadona.id, position: 0, text: 'Plátanos', amount: 250 });
});

test('by the shop, accents aside', async () =>
	expect(
		(await searchExpenses(k, { text: 'cafe', from: null, to: null })).map((e) => e.store)
	).toEqual(['Café Central']));

test('by a line', async () =>
	expect(
		(await searchExpenses(k, { text: 'platano', from: null, to: null })).map((e) => e.store)
	).toEqual(['Mercadona']));

test('between two days', async () =>
	expect(
		(await searchExpenses(k, { text: '', from: '2026-10-21', to: '2026-10-31' })).map(
			(e) => e.store
		)
	).toEqual(['Café Central']));
