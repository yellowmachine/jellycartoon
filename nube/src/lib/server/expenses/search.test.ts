import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import { expense, expenseLine, family, income } from '#lib/server/db/schema.ts';
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
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	VISION_MODEL: ''
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
const { searchExpenses } = await import('./expenses.ts');
const { moneyDocuments } = await import('./documents.ts');

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

test('what Papeles finds (#401): only with its file, by line or concept, the newest first', async () => {
	const [media] = await db
		.insert(expense)
		.values({
			familyId: 'A',
			date: '2026-09-01',
			store: 'MediaMarkt',
			category: 'Casa',
			total: 49900,
			source: 'mano',
			receipt: 'media.pdf'
		})
		.returning();
	await db.insert(expenseLine).values({
		familyId: 'A',
		expenseId: media.id,
		position: 0,
		text: 'Lavadora Bosch',
		amount: 49900
	});
	// The same words, without a file: not a paper.
	await db.insert(expense).values({
		familyId: 'A',
		date: '2026-09-02',
		store: 'Lavadora a mano',
		category: 'Casa',
		total: 100,
		source: 'mano'
	});
	const [sale] = await db
		.insert(income)
		.values({
			familyId: 'A',
			date: '2026-10-01',
			concept: 'Venta de lavadora vieja',
			category: 'Otros',
			amount: 5000,
			document: 'venta.pdf'
		})
		.returning();
	await db.insert(income).values({
		familyId: 'A',
		date: '2026-10-02',
		concept: 'Lavadora sin factura',
		category: 'Otros',
		amount: 100
	});
	const found = await moneyDocuments(k, 'LAVADORA');
	expect(found.map((d) => [d.kind, d.id])).toEqual([
		['ingreso', sale.id],
		['gasto', media.id]
	]);
	expect(found[1]).toMatchObject({
		title: 'MediaMarkt',
		line: 'Lavadora Bosch',
		file: `/gastos/ticket/${media.id}`,
		place: `/gastos?mes=2026-09&gasto=${media.id}`
	});
	expect(found[0]!.line).toBeNull();
	expect(await moneyDocuments(k, 'nada de esto')).toEqual([]);
});
