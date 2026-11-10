import { beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { expense, expenseLine, expenseTag, family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { lineKey, ownTagOf } from 'comun/expenses.ts';
import { ownTags, taggedExpenseIds, tagLine } from './own-tags.ts';

/** Own tags of lines (#459) on a real Postgres (PGlite, in memory), with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
/** As the app's role, to whom row-level security applies. */
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
const a = kitchenOf('A');
const b = kitchenOf('B');

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

test('the key: case, accents and spaces aside, the rest as it is', () => {
	expect(lineKey('  Barra   PICOS ')).toBe('barra picos');
	expect(lineKey('Café Molído')).toBe('cafe molido');
	expect(lineKey('barra picos integral')).not.toBe(lineKey('barra picos'));
});

test('a new tag by name, then the same text written otherwise has it', async () => {
	expect(await tagLine(a, 'BARRA PICOS', { name: ' Pan ' })).toBe(true);
	const own = await ownTags(a);
	expect(own.tags.map((t) => t.name)).toEqual(['Pan']);
	expect(ownTagOf(own, 'Barra  picos')?.name).toBe('Pan');
	expect(ownTagOf(own, 'barra picos integral')).toBeNull();
});

test('the same name (case and accents aside) is the same tag', async () => {
	await tagLine(a, 'PAN RUSTICO', { name: 'pán' });
	const own = await ownTags(a);
	expect(own.tags.map((t) => t.name)).toEqual(['Pan']);
	expect(ownTagOf(own, 'pan rústico')?.name).toBe('Pan');
});

test('changing a text to another tag, and the one left with no line goes', async () => {
	await tagLine(a, 'AGUA BEZOYA', { name: 'Pan' });
	await tagLine(a, 'AGUA BEZOYA', { name: 'Agua' });
	let own = await ownTags(a);
	expect(ownTagOf(own, 'agua bezoya')?.name).toBe('Agua');
	await tagLine(a, 'AGUA BEZOYA', null);
	own = await ownTags(a);
	expect(ownTagOf(own, 'agua bezoya')).toBeNull();
	expect(own.tags.map((t) => t.name)).toEqual(['Pan']);
});

test('by its id; another family’s tag, or an empty text or name, is refused', async () => {
	const [pan] = (await ownTags(a)).tags;
	expect(await tagLine(a, 'CHAPATA', { tagId: pan.id })).toBe(true);
	expect(ownTagOf(await ownTags(a), 'chapata')?.name).toBe('Pan');
	expect(await tagLine(b, 'CHAPATA', { tagId: pan.id })).toBe(false);
	expect(await tagLine(a, '   ', { name: 'Pan' })).toBe(false);
	expect(await tagLine(a, 'CHAPATA', { name: '  ' })).toBe(false);
});

test('each family sees only its own', async () => {
	await tagLine(b, 'BARRA PICOS', { name: 'Picos' });
	expect(ownTagOf(await ownTags(b), 'barra picos')?.name).toBe('Picos');
	expect(ownTagOf(await ownTags(a), 'barra picos')?.name).toBe('Pan');
	expect((await db.select().from(expenseTag)).length).toBe(2);
});

test('the expenses with a line of a tag, between two days', async () => {
	const add = async (date: string, lines: string[]) => {
		const [e] = await db
			.insert(expense)
			.values({
				familyId: 'A',
				date,
				store: 'Horno',
				category: 'Comida',
				total: 100,
				source: 'mano'
			})
			.returning();
		await db.insert(expenseLine).values(
			lines.map((text, position) => ({
				familyId: 'A',
				expenseId: e.id,
				position,
				text,
				amount: 50
			}))
		);
		return e.id;
	};
	const october = await add('2026-10-05', ['Barra  Picos', 'Leche']);
	const november = await add('2026-11-05', ['BARRA PICOS', 'Barra picos']);
	await add('2026-11-06', ['Barra picos integral']);
	const pan = (await ownTags(a)).tags.find((t) => t.name === 'Pan')!;
	expect((await taggedExpenseIds(a, pan.id, { from: null, to: null })).sort()).toEqual(
		[october, november].sort()
	);
	expect(await taggedExpenseIds(a, pan.id, { from: '2026-11-01', to: null })).toEqual([november]);
	// Another family's tag: nothing of A's.
	const picos = (await ownTags(b)).tags[0];
	expect(await taggedExpenseIds(a, picos.id, { from: null, to: null })).toEqual([]);
});
