import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { bill, expense, family, familySettings } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { parseBillDetails } from 'comun/bills.ts';
import { sameText } from 'comun/page-notices.ts';
import { lookingSame, markNotSame, monthRepeated, sameBy, type Compared } from './duplicates.ts';
import { setNoticeKind, setPageNotices } from '../page-notices.ts';

/** Put in twice (#440) on a real Postgres (PGlite, in memory), with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
const kitchenOf = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
			return fn(tx);
		})
});
const k = kitchenOf('A');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
});

beforeEach(async () => {
	await db.delete(expense);
	await db.delete(familySettings);
});

const base: Compared = {
	id: null,
	date: '2026-11-03',
	store: 'Mercadona',
	total: 2345,
	source: 'ticket',
	fileHash: null,
	bill: null
};

async function put(familyId: string, values: Partial<typeof expense.$inferInsert> = {}) {
	const [row] = await db
		.insert(expense)
		.values({
			familyId,
			date: base.date,
			store: base.store,
			category: 'Supermercado',
			total: base.total,
			source: 'ticket',
			...values
		})
		.returning({ id: expense.id });
	return row!.id;
}

test('the rule: file, period, or day and total with a receipt', () => {
	const other = { ...base, id: 1 };
	expect(sameBy(base, other)).toBe('dia');
	// The shop as the AI writes it does not matter.
	expect(sameBy(base, { ...other, store: 'MERCADONA S.A.' })).toBe('dia');
	expect(sameBy(base, { ...other, total: 2346 })).toBeNull();
	// Two by hand, the same day and amount: two coffees.
	expect(sameBy({ ...base, source: 'mano' }, { ...other, source: 'voz' })).toBeNull();
	// One by hand and its receipt later.
	expect(sameBy(base, { ...other, source: 'mano' })).toBe('dia');
	// The same file, read differently.
	expect(
		sameBy({ ...base, fileHash: 'f' }, { ...other, fileHash: 'f', date: '2026-11-04', total: 1 })
	).toBe('fichero');
	// Bills by their period, not by their day.
	const light = { kind: 'Luz', periodStart: '2026-09-15', periodEnd: '2026-10-14' };
	expect(
		sameBy(
			{ ...base, source: 'factura', bill: light },
			{ ...other, source: 'factura', bill: light, date: '2026-11-10', total: 1 }
		)
	).toBe('periodo');
	expect(
		sameBy(
			{ ...base, source: 'factura', bill: light },
			{ ...other, source: 'factura', bill: { ...light, kind: 'Agua' } }
		)
	).toBeNull();
	// Not with itself.
	expect(sameBy(other, other)).toBeNull();
});

test('the notice says which, and when', () => {
	const l = { id: 1, date: '2026-11-03', store: 'Mercadona', total: 2345, by: 'dia' as const };
	expect(sameText(l, '2026-11-05')).toBe(
		'Esto parece igual al del martes: Mercadona, 23,45 € (mismo día y mismo total).'
	);
	expect(sameText(l, '2026-11-03')).toContain('igual al de hoy:');
	expect(sameText(l, '2026-11-20')).toContain('igual al del 3 de noviembre:');
});

test('before saving: the one it looks the same as, only of its family', async () => {
	await put('B');
	expect(await lookingSame(k, base)).toBeNull();
	const id = await put('A', { source: 'mano' });
	expect(await lookingSame(k, base)).toMatchObject({ id, by: 'dia', store: 'Mercadona' });
	const hashed = await put('A', { fileHash: 'a'.repeat(64), date: '2026-10-01', total: 5 });
	expect(await lookingSame(k, { ...base, total: 1, fileHash: 'a'.repeat(64) })).toMatchObject({
		id: hashed,
		by: 'fichero'
	});
});

test('a bill of the same period, whatever its day', async () => {
	const id = await put('A', { source: 'factura', date: '2026-10-20', total: 6000 });
	await db.insert(bill).values({
		familyId: 'A',
		expenseId: id,
		kind: 'Luz',
		periodStart: '2026-09-15',
		periodEnd: '2026-10-14',
		unit: 'kWh',
		details: parseBillDetails({})
	});
	const light = { kind: 'Luz', periodStart: '2026-09-15', periodEnd: '2026-10-14' };
	expect(await lookingSame(k, { ...base, source: 'factura', bill: light })).toMatchObject({
		id,
		by: 'periodo'
	});
});

test('in the month: on the newer one, until «No es repetido»', async () => {
	const older = await put('A');
	const newer = await put('A', { store: 'MERCADONA' });
	await put('A', { date: '2026-11-04' });
	const found = await monthRepeated(k, '2026-11');
	expect(Object.keys(found).map(Number)).toEqual([newer]);
	expect(found[newer]).toMatchObject({ id: older, by: 'dia' });
	await markNotSame(k, newer, older);
	await markNotSame(k, older, newer);
	expect(await monthRepeated(k, '2026-11')).toEqual({});
});

test('nothing with the notices off, or that kind', async () => {
	await put('A');
	const newer = await put('A');
	await setNoticeKind(k, 'repetido', false);
	expect(await monthRepeated(k, '2026-11')).toEqual({});
	expect(await lookingSame(k, base)).toBeNull();
	await setNoticeKind(k, 'repetido', true);
	expect(Object.keys(await monthRepeated(k, '2026-11')).map(Number)).toEqual([newer]);
	await setPageNotices(k, false);
	expect(await monthRepeated(k, '2026-11')).toEqual({});
});
