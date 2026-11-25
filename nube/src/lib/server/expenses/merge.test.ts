import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import {
	bankPayment,
	expense,
	expenseLine,
	family,
	familyMember,
	familyPerson,
	recurringExpense,
	user,
	wish
} from '../db/schema.ts';
import { familyScope } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/** «Juntarlos» and «Cargos que vienen», on PGlite as the app's role. */
const db = drizzle(new PGlite(), { schema });
mock.module('#lib/server/db/index.ts', () => ({ db }));
const withFamily = familyScope(db, { role: 'app_user' });
const kitchenOf = (familyId: string, userId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const { mergeInto, mergeOfDraft, monthMerged, monthMerges, splitMerge } =
	await import('./merge.ts');
const { chargeNotices, closeCharges, comingCharges, setChargeNotices } =
	await import('./charges.ts');
const ana = kitchenOf('A', 'ana');
const otro = kitchenOf('B', 'otro');
const people: Record<string, number> = {};

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	const at = new Date();
	await db.insert(user).values(
		['ana', 'luis', 'otro'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: at,
			updatedAt: at
		}))
	);
	await db.insert(family).values([
		{ id: 'A', name: 'A' },
		{ id: 'B', name: 'B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	for (const p of await db
		.insert(familyPerson)
		.values([
			{ familyId: 'A', userId: 'ana', name: 'Ana' },
			{ familyId: 'A', userId: 'luis', name: 'Luis' }
		])
		.returning())
		people[p.name] = p.id;
});
beforeEach(async () => {
	await db.delete(wish);
	await db.delete(bankPayment);
	await db.delete(expense);
	await db.delete(recurringExpense);
});

async function put(total: number, more: Partial<typeof expense.$inferInsert> = {}, line = '') {
	const [e] = await db
		.insert(expense)
		.values({
			familyId: 'A',
			date: '2026-11-20',
			store: 'IberLibro',
			category: 'Otros',
			total,
			source: 'mano',
			userId: 'ana',
			...more
		})
		.returning();
	if (line)
		await db
			.insert(expenseLine)
			.values({ familyId: 'A', expenseId: e!.id, position: 0, text: line, amount: total });
	return e!.id;
}
const wished = (expenseId: number, boughtBy: string, person = 'Ana') =>
	db
		.insert(wish)
		.values({
			familyId: 'A',
			personId: people[person]!,
			url: 'https://www.iberlibro.com/x',
			shop: 'IberLibro',
			title: 'Cien años de soledad',
			boughtOn: '2026-11-20',
			boughtBy,
			expenseId
		})
		.returning();
const bill = { date: '2026-11-24', store: 'Iberlibro', total: 3600, lines: [] };
const all = () => db.select().from(expense).orderBy(expense.id);

test('two wishes’ expenses and their bill: proposed, gathered, and separated as they were', async () => {
	const a = await put(1811, {}, 'El nombre de la rosa');
	const b = await put(1789);
	const [w] = await wished(b, 'ana');
	const found = await mergeOfDraft(ana, bill);
	expect(found?.map((p) => [p.id, p.text])).toEqual([
		[a, 'El nombre de la rosa'],
		[b, 'Cien años de soledad']
	]);
	const into = await put(3600, { date: bill.date, source: 'factura', receipt: 'x.pdf' });
	expect(Object.keys(await monthMerges(ana, '2026-11'))).toEqual([String(into)]);
	// Not the other family's to touch.
	expect(await mergeInto(otro, into, [a, b])).toBe(false);
	expect(await mergeInto(ana, into, [a, b])).toBe(true);
	expect((await all()).map((e) => e.id)).toEqual([into]);
	expect((await db.select().from(wish))[0]!.expenseId).toBe(into);
	// Its lines, as the bill had none.
	expect((await db.select().from(expenseLine)).map((l) => [l.expenseId, l.text])).toEqual([
		[into, 'El nombre de la rosa']
	]);
	expect(await mergeInto(ana, into, [a, b])).toBe(false);
	const [m] = await monthMerged(ana, '2026-11');
	expect(m!.parts).toHaveLength(2);
	expect(await splitMerge(otro, m!.id)).toBe(false);
	expect(await splitMerge(ana, m!.id)).toBe(true);
	const back = await all();
	expect(back.map((e) => [e.total, e.source, e.userId])).toEqual([
		[3600, 'factura', 'ana'],
		[1811, 'mano', 'ana'],
		[1789, 'mano', 'ana']
	]);
	const [again] = await db.select().from(wish).where(eq(wish.id, w!.id));
	expect(again!.expenseId).toBe(back[2]!.id);
	expect((await db.select().from(expenseLine)).map((l) => l.expenseId)).toEqual([back[1]!.id]);
	expect(await splitMerge(ana, m!.id)).toBe(false);
	// Just separated: not proposed again.
	expect(await monthMerges(ana, '2026-11')).toEqual({});
});

test('not another adult’s gift, nor what has its own receipt, is fixed or is far in time', async () => {
	const a = await put(1811);
	const gift = await put(1789);
	await wished(gift, 'ana', 'Luis');
	expect(await mergeOfDraft(ana, bill)).toBeNull();
	const into = await put(3600, { source: 'banco', date: bill.date });
	expect(await mergeInto(ana, into, [a, gift])).toBe(false);
	expect(await all()).toHaveLength(3);
	await db.update(expense).set({ receipt: 'r.jpg' }).where(eq(expense.id, a));
	expect(await mergeInto(ana, into, [a])).toBe(false);
	// Into one by hand, nothing.
	const hand = await put(100);
	const other = await put(100);
	expect(await mergeInto(ana, hand, [other])).toBe(false);
	await db.delete(wish);
	await db.delete(expense);
	await put(1811, { date: '2026-11-01' });
	await put(1789, { date: '2026-11-01' });
	expect(await mergeOfDraft(ana, bill)).toBeNull();
});

test('a bank’s payment gathers them, and what their own payments pointed at', async () => {
	const a = await put(1811);
	const b = await put(1789);
	const [p] = await db
		.insert(bankPayment)
		.values({ familyId: 'A', provider: 'bunq', paymentId: 7, userId: 'ana', expenseId: a })
		.returning();
	const into = await put(3600, { source: 'banco' });
	expect(await mergeInto(ana, into, [a, b])).toBe(true);
	expect((await db.select().from(bankPayment))[0]).toMatchObject({ id: p!.id, expenseId: into });
});

test('charges that come: whose, when, closed until the next time', async () => {
	const luis = kitchenOf('A', 'luis');
	const fixed = (more: Partial<typeof recurringExpense.$inferInsert>) =>
		db
			.insert(recurringExpense)
			.values({
				familyId: 'A',
				name: 'Prime',
				category: 'Suscripciones',
				amount: 4990,
				day: 28,
				month: 11,
				lastMonth: '2025-11',
				userId: 'ana',
				...more
			})
			.returning();
	const [prime] = await fixed({ paidFrom: 'Santander' });
	// Every month's, not told by default.
	const [rent] = await fixed({ name: 'Alquiler', month: null, lastMonth: '2026-10' });
	const names = async (k: Kitchen, who: string, day = '2026-11-25') =>
		(await comingCharges(k, who, day)).map((c) => `${c.name} ${c.left}`);
	expect(await names(ana, 'ana')).toEqual(['Prime 3']);
	expect(await names(ana, 'ana', '2026-11-20')).toEqual([]);
	expect(await names(luis, 'luis')).toEqual([]);
	await db
		.update(recurringExpense)
		.set({ noticeAll: true })
		.where(eq(recurringExpense.id, prime!.id));
	expect(await names(luis, 'luis')).toEqual(['Prime 3']);
	// Its own days, over the usual.
	await db.update(recurringExpense).set({ notice: 3 }).where(eq(recurringExpense.id, rent!.id));
	expect(await names(ana, 'ana')).toEqual(['Prime 3', 'Alquiler 3']);
	// Closed by one: not by the other; and it comes again the next time.
	await closeCharges(ana, 'ana', [{ id: rent!.id, day: '2026-11-28' }], '2026-11-25');
	await closeCharges(ana, 'ana', [{ id: prime!.id, day: '2026-11-28' }], '2026-11-25');
	expect(await names(ana, 'ana')).toEqual([]);
	expect(await names(luis, 'luis')).toEqual(['Prime 3']);
	expect(await names(ana, 'ana', '2026-12-26')).toEqual(['Alquiler 2']);
	await setChargeNotices(luis, 'luis', { on: false, monthly: 0, yearly: 7 });
	expect(await names(luis, 'luis')).toEqual([]);
	expect((await chargeNotices(ana, 'ana')).closed).toEqual({
		[rent!.id]: '2026-11-28',
		[prime!.id]: '2026-11-28'
	});
	expect(await names(otro, 'otro')).toEqual([]);
});
