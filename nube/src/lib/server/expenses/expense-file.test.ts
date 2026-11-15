import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { parseBillDetails } from 'comun/bills.ts';
import type { ExpenseInput } from 'comun/expenses.ts';
import * as schema from '#lib/server/db/schema.ts';
import { expense, family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** An expense's receipt or bill: only kept with the expense, under no temporary name. */
const files = new Map<string, Uint8Array>();
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (_family: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${area}/${name}`, body),
	removeFile: async (_family: string, area: string, name: string) =>
		void files.delete(`${area}/${name}`),
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	VISION_MODEL: '',
	// chat.test.ts's, unused here.
	chatWithTools: async () => {
		throw new Error('Sin IA en esta prueba');
	},
	sayableError: (message: string) => message
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
mock.module('#lib/server/fridge.ts', () => ({
	today: () => '2026-11-05',
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	// A mock is the whole process's: for the tests that come after and only import these.
	houseKitchen: () => {
		throw new Error('Sin cocina en esta prueba');
	},
	kitchenOf: () => {
		throw new Error('Sin cocina en esta prueba');
	},
	// chat.test.ts's, unused here: a mock's names are fixed by the first one.
	toBuy: async () => [],
	addItems: async () => []
}));

const { addExpense } = await import('./expenses.ts');
const { NotADocument } = await import('./income.ts');

const db = drizzle(new PGlite(), { schema });
const k: Kitchen = { familyId: 'A', userId: null, run: (fn) => db.transaction((tx) => fn(tx)) };
const lunch: ExpenseInput = {
	date: '2026-11-05',
	store: 'Bar',
	category: 'Otros',
	total: 100,
	lines: []
};
const PDF = new TextEncoder().encode('%PDF-1.7 factura');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
});

const receiptOf = async (id: number) =>
	(await db.select().from(expense).where(eq(expense.id, id)))[0]?.receipt;

test('kept with the expense, by what it is', async () => {
	const photo = await receiptOf(await addExpense(k, lunch, 'ticket', JPEG));
	const bill = await receiptOf(await addExpense(k, lunch, 'factura', PDF));
	expect(photo).toEndWith('.jpg');
	expect(bill).toEndWith('.pdf');
	expect(files.get(`gastos/${photo}`)).toEqual(JPEG);
	expect(files.get(`gastos/${bill}`)).toEqual(PDF);
	expect([...files.keys()].some((name) => name.includes('tmp-'))).toBe(false);
});

test('without a file, none', async () => {
	expect(await receiptOf(await addExpense(k, lunch, 'mano'))).toBeNull();
});

test('not a document: no expense and no file', async () => {
	const before = [(await db.select().from(expense)).length, files.size];
	const notOne = new TextEncoder().encode('una nota');
	await expect(addExpense(k, lunch, 'ticket', notOne)).rejects.toThrow(NotADocument);
	expect([(await db.select().from(expense)).length, files.size]).toEqual(before);
});

test('the expense not saved: its file not left behind', async () => {
	const before = files.size;
	const failing: Kitchen = {
		...k,
		run: () => Promise.reject(new Error('sin base de datos'))
	};
	await expect(addExpense(failing, lunch, 'ticket', JPEG)).rejects.toThrow('sin base de datos');
	expect(files.size).toBe(before);
});

// The month's receipt of a fixed one (#501), on the expense it added: not another.
const { attachReceipt, bestFixed, dropReceipt, fixedMatchOf } = await import('./fixed-receipt.ts');
const { recurringExpense } = schema;

/** A fixed one, and its expense of that day without a receipt. */
async function fixedOn(date: string, store: string, total: number) {
	const [r] = await db
		.insert(recurringExpense)
		.values({ familyId: 'A', name: store, category: 'Casa', amount: total, day: 5 })
		.returning();
	return addExpense(k, { date, store, category: 'Casa', total, lines: [] }, 'fijo', null, r!.id);
}

const luzBill = {
	date: '2026-12-02',
	store: 'Iberdrola',
	total: 6234,
	bill: {
		kind: 'Luz' as const,
		periodStart: '2026-10-01',
		periodEnd: '2026-10-31',
		consumption: 250,
		unit: 'kWh' as const,
		details: parseBillDetails(null)
	}
};

test('a fixed one: its receipt kept on it, replaced and dropped', async () => {
	const id = await fixedOn('2026-11-05', 'Alquiler', 70000);
	expect(await attachReceipt(k, id, JPEG, 'a'.repeat(64))).toBe(true);
	const first = await receiptOf(id);
	expect(files.get(`gastos/${first}`)).toEqual(JPEG);
	expect(await attachReceipt(k, id, PDF)).toBe(true);
	const second = await receiptOf(id);
	expect(second).toEndWith('.pdf');
	// The one it had, gone from the storage.
	expect(files.has(`gastos/${first}`)).toBe(false);
	expect(await dropReceipt(k, id)).toBe(true);
	expect(await receiptOf(id)).toBeNull();
	expect(files.has(`gastos/${second}`)).toBe(false);
	expect(await dropReceipt(k, id)).toBe(false);
});

test('an expense gone: nothing kept', async () => {
	const before = files.size;
	expect(await attachReceipt(k, 999_999, JPEG)).toBe(false);
	expect(files.size).toBe(before);
	await expect(attachReceipt(k, 999_999, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
		NotADocument
	);
});

test('a bill read: the fixed one of its supply, its month or the one before', async () => {
	await db.delete(expense);
	// November's light, still without its bill, which comes on 2 December.
	const luz = await fixedOn('2026-11-05', 'Luz', 5500);
	await fixedOn('2026-11-05', 'Netflix', 1399);
	expect((await fixedMatchOf(k, luzBill))?.id).toBe(luz);
	// With its receipt, it is not asked again.
	await attachReceipt(k, luz, PDF);
	expect(await fixedMatchOf(k, luzBill)).toBeNull();
	// Two months before: not that one.
	const october = await fixedOn('2026-10-05', 'Luz', 5500);
	expect(await fixedMatchOf(k, luzBill)).toBeNull();
	expect((await fixedMatchOf(k, { ...luzBill, date: '2026-11-20' }))?.id).toBe(october);
});

test('the best fixed one: by name, then its own month, then the nearest amount', () => {
	const c = (id: number, date: string, store: string, total: number) => ({
		id,
		date,
		store,
		category: 'Casa' as const,
		total
	});
	const ticket = { date: '2026-11-10', store: 'Gimnasio Fit', total: 3500, bill: null };
	// By its name, in the shop.
	expect(bestFixed(ticket, [c(1, '2026-11-01', 'Gimnasio', 3000)])?.id).toBe(1);
	// A receipt of the shop far from it is another purchase: the order is not Prime.
	const order = { date: '2026-11-11', store: 'Amazon', total: 4250, bill: null };
	expect(bestFixed(order, [c(8, '2026-11-11', 'Amazon Prime', 499)])).toBeNull();
	expect(bestFixed({ ...order, total: 499 }, [c(8, '2026-11-11', 'Amazon Prime', 499)])?.id).toBe(
		8
	);
	// By an amount near enough, without the name; not far.
	expect(bestFixed(ticket, [c(2, '2026-11-01', 'Cuota', 3520)])?.id).toBe(2);
	expect(bestFixed(ticket, [c(3, '2026-11-01', 'Cuota', 5000)])).toBeNull();
	// The supply in the name: «Luz casa».
	expect(bestFixed(luzBill, [c(4, '2026-11-05', 'Luz casa', 9000)])?.id).toBe(4);
	// A name before an amount; its own month before the one before.
	expect(
		bestFixed(luzBill, [
			c(5, '2026-12-01', 'Seguro', 6234),
			c(6, '2026-11-05', 'Luz', 5000),
			c(7, '2026-12-01', 'Luz', 5000)
		])?.id
	).toBe(7);
});
