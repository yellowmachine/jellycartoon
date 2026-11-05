import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
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
	VISION_MODEL: ''
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
	}
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
