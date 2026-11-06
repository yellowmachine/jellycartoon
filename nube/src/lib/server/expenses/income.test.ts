import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { parseIncomeInput, parseRecurringIncome } from 'comun/income.ts';

/**
 * Dinero's income (#384) on PGlite, with the family's files faked. The whole storage module, as
 * a mock is the process's: whichever test mocks it first, the files are looked at through it.
 */
const files = new Map<string, Uint8Array>();
const at = (familyId: string, area: string, name: string) => `${familyId}/${area}/${name}`;
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async (familyId: string, area: string, name: string, body: Uint8Array) =>
		void files.set(at(familyId, area, name), body),
	readFile: async (familyId: string, area: string, name: string) =>
		files.get(at(familyId, area, name)) ?? null,
	removeFile: async (familyId: string, area: string, name: string) =>
		void files.delete(at(familyId, area, name)),
	listFiles: async (familyId: string, area: string) =>
		[...files.keys()]
			.filter((key) => key.startsWith(`${familyId}/${area}/`))
			.map((key) => key.slice(`${familyId}/${area}/`.length)),
	fileResponse: async () => new Response()
}));

const { readFile } = await import('#lib/server/storage.ts');
const {
	addDueRecurringIncome,
	addIncome,
	addRecurringIncome,
	deleteIncome,
	deleteRecurringIncome,
	incomeDocument,
	INCOME_AREA,
	kindOf,
	makeRecurringIncome,
	monthIncome,
	monthIncomeTotal,
	NotADocument,
	recurringIncomes,
	typeOf,
	updateIncome,
	updateRecurringIncome
} = await import('./income.ts');

const db = drizzle(new PGlite(), { schema });
const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => db.transaction((tx) => fn(tx))
});
const a = kitchen('A');

const PDF = new TextEncoder().encode('%PDF-1.7 factura');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const kept = async (name: string | null) =>
	name ? (await readFile('A', INCOME_AREA, name)) !== null : false;

const harvest = {
	date: '2026-08-20',
	concept: 'Cosecha',
	category: 'Campo y cosechas',
	amount: 80_000
} as const;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
});

describe('parseIncomeInput', () => {
	test('well formed: trimmed', () => {
		expect(parseIncomeInput({ ...harvest, concept: '  Cosecha  ' })).toEqual(harvest);
	});

	test('nothing missing, a known category, over zero', () => {
		expect(parseIncomeInput({ ...harvest, concept: ' ' })).toBeNull();
		expect(parseIncomeInput({ ...harvest, category: 'Lotería' })).toBeNull();
		expect(parseIncomeInput({ ...harvest, amount: 0 })).toBeNull();
		expect(parseIncomeInput({ ...harvest, amount: 12.5 })).toBeNull();
		expect(parseIncomeInput({ ...harvest, date: '2026-02-30' })).toBeNull();
	});
});

describe('what a file is', () => {
	test('by its first bytes, not by its name', () => {
		expect(kindOf(PDF)).toBe('application/pdf');
		expect(kindOf(JPEG)).toBe('image/jpeg');
		expect(kindOf(new TextEncoder().encode('<html>'))).toBeNull();
		expect(typeOf('x.pdf')).toBe('application/pdf');
		expect(typeOf('x.exe')).toBeNull();
	});
});

describe('income', () => {
	test('written down with its invoice, in its month and its total', async () => {
		const id = await addIncome(a, harvest, PDF);
		await addIncome(
			a,
			{ ...harvest, date: '2026-08-02', concept: 'Devolución', amount: 1_550 },
			null
		);
		await addIncome(a, { ...harvest, date: '2026-09-01' }, null);
		const august = await monthIncome(a, '2026-08');
		expect(august.map((i) => i.concept)).toEqual(['Cosecha', 'Devolución']);
		expect(august[0]!.document).toBe('pdf');
		expect(await monthIncomeTotal(a, '2026-08')).toBe(81_550);
		expect(await kept(await incomeDocument(a, id))).toBe(true);
	});

	test('not a PDF nor a picture: refused, and nothing written down', async () => {
		const before = (await monthIncome(a, '2026-07')).length;
		await expect(
			addIncome(a, { ...harvest, date: '2026-07-01' }, new TextEncoder().encode('MZ'))
		).rejects.toBeInstanceOf(NotADocument);
		expect((await monthIncome(a, '2026-07')).length).toBe(before);
	});

	test('its invoice changed for another, or taken away: the old one deleted', async () => {
		const id = await addIncome(a, { ...harvest, date: '2026-06-10' }, PDF);
		const first = await incomeDocument(a, id);
		expect(await updateIncome(a, id, { ...harvest, date: '2026-06-10' }, { file: JPEG })).toBe(
			true
		);
		const second = await incomeDocument(a, id);
		expect(second).toEndWith('.jpg');
		expect(await kept(first)).toBe(false);
		await updateIncome(a, id, { ...harvest, date: '2026-06-10', amount: 9_000 });
		expect(await incomeDocument(a, id)).toBe(second);
		await updateIncome(a, id, { ...harvest, date: '2026-06-10' }, { dropDocument: true });
		expect(await incomeDocument(a, id)).toBeNull();
		expect(await kept(second)).toBe(false);
	});

	test('deleted, with its invoice', async () => {
		const id = await addIncome(a, { ...harvest, date: '2026-05-05' }, PDF);
		const name = await incomeDocument(a, id);
		expect(await deleteIncome(a, id)).toBe(true);
		expect(await kept(name)).toBe(false);
		expect(await monthIncome(a, '2026-05')).toEqual([]);
		expect(await updateIncome(a, id, harvest)).toBe(false);
	});
});

describe('parseRecurringIncome', () => {
	const salary = {
		concept: ' Nómina ',
		category: 'Trabajo',
		amount: 150_000,
		day: 28,
		month: null
	} as const;

	test('well formed: trimmed', () => {
		expect(parseRecurringIncome(salary)).toEqual({ ...salary, concept: 'Nómina' });
		expect(parseRecurringIncome({ ...salary, month: 12 })?.month).toBe(12);
	});

	test('a day every month has, a real month, over zero', () => {
		expect(parseRecurringIncome({ ...salary, day: 29 })).toBeNull();
		expect(parseRecurringIncome({ ...salary, day: 0 })).toBeNull();
		expect(parseRecurringIncome({ ...salary, month: 13 })).toBeNull();
		expect(parseRecurringIncome({ ...salary, amount: null })).toBeNull();
		expect(parseRecurringIncome({ ...salary, category: 'Lotería' })).toBeNull();
		expect(parseRecurringIncome({ ...salary, concept: ' ' })).toBeNull();
	});
});

describe('fixed income', () => {
	// Each its own database: here the rows are not kept apart by family, as there is no app role.
	async function own(id: string): Promise<Kitchen> {
		const own = drizzle(new PGlite(), { schema });
		await migrate(own, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
		await own.insert(family).values({ id, name: id });
		return { familyId: id, userId: null, run: (fn) => own.transaction((tx) => fn(tx)) };
	}
	let b: Kitchen, c: Kitchen, d: Kitchen;

	const salary = {
		concept: 'Nómina',
		category: 'Trabajo',
		amount: 150_000,
		day: 25,
		month: null
	} as const;
	const concepts = async (k: Kitchen, month: string) =>
		(await monthIncome(k, month)).map((i) => [i.date, i.concept, i.fixed]);

	beforeAll(async () => {
		[b, c, d] = await Promise.all([own('B'), own('C'), own('D')]);
	});

	test('starts at its next day, then once a month, also those nobody looked at', async () => {
		await addRecurringIncome(b, salary, '2026-08-26');
		await addDueRecurringIncome(b, '2026-08-31');
		expect(await monthIncome(b, '2026-08')).toEqual([]);
		await addDueRecurringIncome(b, '2026-09-24');
		expect(await monthIncome(b, '2026-09')).toEqual([]);
		await addDueRecurringIncome(b, '2026-11-25');
		await addDueRecurringIncome(b, '2026-11-25');
		expect(await concepts(b, '2026-09')).toEqual([['2026-09-25', 'Nómina', true]]);
		expect(await concepts(b, '2026-10')).toEqual([['2026-10-25', 'Nómina', true]]);
		expect(await concepts(b, '2026-11')).toEqual([['2026-11-25', 'Nómina', true]]);
	});

	test('two opened at once add it once', async () => {
		await Promise.all([
			addDueRecurringIncome(b, '2026-12-25'),
			addDueRecurringIncome(b, '2026-12-25')
		]);
		expect(await monthIncomeTotal(b, '2026-12')).toBe(150_000);
	});

	test('one corrected or deleted by hand is not added again', async () => {
		const [dec] = await monthIncome(b, '2026-12');
		await updateIncome(b, dec!.id, { ...salary, date: dec!.date, amount: 170_000 });
		await addDueRecurringIncome(b, '2026-12-31');
		expect(await monthIncomeTotal(b, '2026-12')).toBe(170_000);
		const [fixed] = await monthIncome(b, '2026-12');
		expect(fixed!.fixed).toBe(true);
		await deleteIncome(b, dec!.id);
		await addDueRecurringIncome(b, '2026-12-31');
		expect(await monthIncome(b, '2026-12')).toEqual([]);
		await addDueRecurringIncome(b, '2027-01-25');
		expect(await monthIncomeTotal(b, '2027-01')).toBe(150_000);
	});

	test('its new amount from the next one; moved to a day gone, not added for it', async () => {
		const [r] = await recurringIncomes(b);
		await updateRecurringIncome(b, r!.id, { ...salary, amount: 160_000, day: 10 }, '2027-02-15');
		await addDueRecurringIncome(b, '2027-02-20');
		expect(await monthIncome(b, '2027-02')).toEqual([]);
		await addDueRecurringIncome(b, '2027-03-10');
		expect(await monthIncomeTotal(b, '2027-03')).toBe(160_000);
	});

	test('yearly: only in its month', async () => {
		await addRecurringIncome(
			c,
			{ ...salary, concept: 'Paga extra', day: 20, month: 12 },
			'2026-01-10'
		);
		await addDueRecurringIncome(c, '2026-12-19');
		expect(await monthIncome(c, '2026-12')).toEqual([]);
		await addDueRecurringIncome(c, '2027-03-01');
		expect(await concepts(c, '2026-12')).toEqual([['2026-12-20', 'Paga extra', true]]);
		expect(await monthIncome(c, '2027-01')).toEqual([]);
	});

	test('one written down made fixed: it is the first, on day 28 at most', async () => {
		const id = await addIncome(
			d,
			{ date: '2026-10-31', concept: 'Pensión', category: 'Ayudas y pensiones', amount: 90_000 },
			null
		);
		expect(await makeRecurringIncome(d, id, false, '2026-11-01')).toBe(true);
		expect(await makeRecurringIncome(d, id, false, '2026-11-01')).toBe(true);
		expect(await makeRecurringIncome(d, 999_999, false, '2026-11-01')).toBe(false);
		const fixed = await recurringIncomes(d);
		expect(fixed).toHaveLength(1);
		expect(fixed[0]).toMatchObject({ concept: 'Pensión', day: 28, month: null, amount: 90_000 });
		await addDueRecurringIncome(d, '2026-11-27');
		expect(await monthIncomeTotal(d, '2026-10')).toBe(90_000);
		expect(await monthIncome(d, '2026-11')).toEqual([]);
		await addDueRecurringIncome(d, '2026-11-28');
		expect(await concepts(d, '2026-11')).toEqual([['2026-11-28', 'Pensión', true]]);
	});

	test('taken away: what it added stays, and no more come', async () => {
		const [r] = await recurringIncomes(d);
		await deleteRecurringIncome(d, r!.id);
		expect(await recurringIncomes(d)).toEqual([]);
		await addDueRecurringIncome(d, '2027-02-01');
		expect(await monthIncome(d, '2026-12')).toEqual([]);
		expect(await concepts(d, '2026-11')).toEqual([['2026-11-28', 'Pensión', false]]);
		expect(await monthIncomeTotal(d, '2026-10')).toBe(90_000);
	});
});
