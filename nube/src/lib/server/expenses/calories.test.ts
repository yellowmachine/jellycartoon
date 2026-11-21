import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import {
	expense,
	expenseLine,
	family,
	familyMember,
	familyPerson,
	foodEstimate,
	user,
	walk
} from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { lineKcal, peopleWeight } from '#lib/calories.ts';
import { caloriesPrompt, estimatesFromAnswer, type ProductAsked } from './calories-parse.ts';

/** Calorías (#562) on a real Postgres (PGlite, in memory), with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
const kitchenOf = (familyId: string, userId: string | null = null): Kitchen => ({
	familyId,
	userId,
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
			return fn(tx);
		})
});

/** What the AI was asked, and what it answers: every product food, 1 kg, 100 kcal/100 g. */
const asked: string[] = [];
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async ({ prompt }: { prompt: string }) => {
		asked.push(prompt);
		const count = prompt.split('\n').filter((l) => /^\d+\. /.test(l)).length;
		return {
			products: Array.from({ length: count }, (_, i) => ({
				n: i + 1,
				food: true,
				byWeight: false,
				grams: 1000,
				kcal100: 100
			}))
		};
	}
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/fridge.ts', () => ({
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	houseKitchen: (familyId: string) => kitchenOf(familyId)
}));

const {
	caloriesView,
	correctEstimate,
	estimateMissing,
	familyPeople,
	pendingProducts,
	recentCalories
} = await import('./calories.ts');

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'eva', 'mia', 'otro'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'eva', familyId: 'A', role: 'member' },
		{ userId: 'mia', familyId: 'A', role: 'peque' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	await db.insert(familyPerson).values([
		{ familyId: 'A', userId: 'ana', name: 'Ana' },
		{ familyId: 'A', name: 'Leo' }
	]);
	const [ticket, bill, other] = await db
		.insert(expense)
		.values([
			{
				familyId: 'A',
				date: '2026-11-16',
				store: 'Súper',
				category: 'Supermercado',
				total: 900,
				source: 'ticket'
			},
			{
				familyId: 'A',
				date: '2026-11-16',
				store: 'Luz',
				category: 'Facturas',
				total: 5000,
				source: 'factura'
			},
			{
				familyId: 'B',
				date: '2026-11-16',
				store: 'Súper',
				category: 'Supermercado',
				total: 100,
				source: 'ticket'
			}
		])
		.returning({ id: expense.id });
	await db.insert(expenseLine).values([
		{
			familyId: 'A',
			expenseId: ticket.id,
			position: 0,
			text: 'PAN BARRA',
			quantity: 2,
			amount: 200,
			tag: 'Panadería'
		},
		{
			familyId: 'A',
			expenseId: ticket.id,
			position: 1,
			text: 'Pan  barra',
			quantity: null,
			amount: 100,
			tag: 'Panadería'
		},
		{
			familyId: 'A',
			expenseId: ticket.id,
			position: 2,
			text: 'LEJIA',
			quantity: 1,
			amount: 150,
			tag: 'Limpieza'
		},
		{
			familyId: 'A',
			expenseId: ticket.id,
			position: 3,
			text: 'DTO',
			quantity: null,
			amount: -50,
			tag: 'Otros'
		},
		{
			familyId: 'A',
			expenseId: ticket.id,
			position: 4,
			text: 'PLATANO',
			quantity: 1.5,
			amount: 300,
			tag: 'Fruta y verdura'
		},
		{
			familyId: 'A',
			expenseId: bill.id,
			position: 0,
			text: 'Término de potencia',
			quantity: null,
			amount: 5000,
			tag: 'Otros'
		},
		{
			familyId: 'B',
			expenseId: other.id,
			position: 0,
			text: 'LECHE',
			quantity: 1,
			amount: 100,
			tag: 'Lácteos y huevos'
		}
	]);
	await db.insert(walk).values([
		{
			familyId: 'A',
			userId: 'ana',
			startedAt: new Date('2026-11-17T10:00:00Z'),
			endedAt: new Date('2026-11-17T11:00:00Z'),
			distance: 4500,
			diagnosis: {} as never
		},
		{
			familyId: 'A',
			userId: 'eva',
			startedAt: new Date('2026-11-17T10:00:00Z'),
			endedAt: new Date('2026-11-17T11:00:00Z'),
			distance: 9000,
			diagnosis: {} as never
		}
	]);
});

test('a line: by weight its kg, else its units (one if not said) of the grams', () => {
	const bread = { food: true, byWeight: false, grams: 250, kcal100: 260 };
	expect(lineKcal(bread, 2)).toBe(1300);
	expect(lineKcal(bread, null)).toBe(650);
	const banana = { food: true, byWeight: true, grams: 1000, kcal100: 90 };
	expect(lineKcal(banana, 1.5)).toBe(1350);
	expect(lineKcal(banana, null)).toBe(900);
	expect(lineKcal({ ...bread, food: false }, 2)).toBe(0);
	// A quantity misread: not 2500 kg of bananas.
	expect(lineKcal(banana, 2500)).toBe(0);
});

test('people: children and those without an account count less, never under one', () => {
	expect(peopleWeight({ adults: 2, children: 2 })).toBeCloseTo(3.2);
	expect(peopleWeight({ adults: 0, children: 0 })).toBe(1);
});

test('the answer by product number; wrong numbers and not-food values left out', () => {
	const products: ProductAsked[] = [
		{ key: 'pan', text: 'PAN', examples: [{ quantity: 1, amount: 100 }] },
		{ key: 'bolsa', text: 'BOLSA', examples: [{ quantity: null, amount: 15 }] }
	];
	expect(caloriesPrompt(products)).toContain('1. PAN — 1 por 1,00 €');
	expect(caloriesPrompt(products)).toContain('2. BOLSA — sin cantidad por 0,15 €');
	const found = estimatesFromAnswer(products, {
		products: [
			{ n: 1, food: true, byWeight: false, grams: 250, kcal100: 5000 },
			{ n: 2, food: false, byWeight: true, grams: 10, kcal100: 0 },
			{ n: 7, food: true, byWeight: false, grams: 1, kcal100: 1 }
		]
	});
	expect(found.get('pan')).toEqual({ food: true, byWeight: false, grams: 250, kcal100: 900 });
	expect(found.get('bolsa')).toEqual({ food: false, byWeight: false, grams: 0, kcal100: 0 });
	expect(found.size).toBe(2);
	expect(estimatesFromAnswer(products, null).size).toBe(0);
});

test('the family: adults by account, children with one or without', async () => {
	expect(await familyPeople(kitchenOf('A'))).toEqual({ adults: 2, children: 2 });
});

test('pending: each product once, only food from what was bought, only its family', async () => {
	const pending = await pendingProducts(kitchenOf('A'));
	expect(pending.map((p) => p.key).sort()).toEqual(['pan barra', 'platano']);
	expect(pending.find((p) => p.key === 'pan barra')?.examples).toHaveLength(2);
});

test('estimated by the AI once; one corrected by hand stays; the view adds it up', async () => {
	const a = kitchenOf('A', 'ana');
	await correctEstimate(a, 'PLÁTANO', { food: true, byWeight: true, grams: 0, kcal100: 90 });
	await estimateMissing('A');
	expect(asked).toHaveLength(1);
	expect(asked[0]).toContain('PAN BARRA');
	expect(asked[0]).not.toContain('PLATANO');
	await estimateMissing('A');
	expect(asked).toHaveLength(1);
	expect(await pendingProducts(a)).toEqual([]);

	const view = await caloriesView(a, 'ana', '2026-11-20');
	// Bread 3 × 1000 g × 100 kcal/100 g, bananas 1,5 kg × 90: 4350, from Monday the 16th to
	// Friday the 20th, among 2 adults and 2 children.
	const week = view.weeks.at(-1)!;
	expect(week.week).toBe('2026-11-16');
	expect(week.days).toBe(5);
	expect(week.perDay).toBeCloseTo(4350 / 5 / 3.2);
	// Only Ana's walks.
	expect(week.km).toBe(4.5);
	expect(view.tags.map((t) => t.tag)).toEqual(['Panadería', 'Fruta y verdura']);
	expect(view.products.map((p) => [p.key, p.kcal, p.estimate?.byHand])).toEqual([
		['pan barra', 3000, false],
		['platano', 1350, true]
	]);
	expect(view.pending).toEqual({ products: 0, lines: 0 });
	// No whole week with food yet.
	expect(view.recent).toBeNull();

	await correctEstimate(a, 'pan barra', { food: false, byWeight: false, grams: 0, kcal100: 0 });
	const after = await caloriesView(a, 'ana', '2026-11-20');
	expect(after.notFood.map((p) => p.key)).toEqual(['pan barra']);
	expect(after.weeks.at(-1)!.perDay).toBeCloseTo(1350 / 5 / 3.2);

	// The other family sees none of it.
	expect(await kitchenOf('B').run((tx) => tx.select().from(foodEstimate))).toEqual([]);
});

test("Paseos' card: the last 4 whole weeks; nothing this week or without Calorías", async () => {
	// The week of the 16th is still going on the 20th: no whole week yet.
	expect(await recentCalories(kitchenOf('A'), '2026-11-20')).toBeNull();
	// A week later it is one of the 4 (only the bananas, the bread now not food).
	expect(await recentCalories(kitchenOf('A'), '2026-11-27')).toBeCloseTo(1350 / 28 / 3.2);
	// A family that has not used Calorías: no card.
	expect(await recentCalories(kitchenOf('B'), '2026-11-27')).toBeNull();
});
