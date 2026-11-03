import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { parseIncomeInput } from 'comun/income.ts';

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
	renameFile: async (familyId: string, area: string, from: string, to: string) => {
		files.set(at(familyId, area, to), files.get(at(familyId, area, from))!);
		files.delete(at(familyId, area, from));
	},
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
	addIncome,
	deleteIncome,
	incomeDocument,
	INCOME_AREA,
	kindOf,
	monthIncome,
	monthIncomeTotal,
	NotADocument,
	typeOf,
	updateIncome
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
