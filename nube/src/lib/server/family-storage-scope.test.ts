import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyStorage } from './db/schema.ts';
import { familyStorageScope, KEEP_COPIES_DAYS } from './family-storage-scope.ts';

/** Where each family's files are, and the moves (#480, phase 2), as the app's role, on PGlite. */
const db = drizzle(new PGlite(), { schema });
const places = familyStorageScope(db, { role: 'app_user' });
const own = { sealed: 'sellado-1', label: 'r2 · fotos · seilide/' };
const other = { sealed: 'sellado-2', label: 'b2 · casa · seilide/' };

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
});

beforeEach(async () => {
	await db.delete(familyStorage);
});

describe('to its own storage', () => {
	test('started, stopped, resumed and finished: then its copies in Seilide go in a week', async () => {
		expect(await places.of('A')).toBeNull();
		expect(await places.start('A', own, 10)).toBe(true);
		expect(await places.start('A', own, 10)).toBe(false);
		expect(await places.pendingMoves()).toEqual(['A']);
		await places.progress('A', 4);
		await places.stopped('A', 'Las claves no valen');
		expect(await places.pendingMoves()).toEqual([]);
		await places.resume('A');
		expect(await places.pendingMoves()).toEqual(['A']);
		const now = new Date('2026-11-12T10:00:00Z');
		await places.finish('A', now);
		const row = await places.of('A');
		expect(row).toMatchObject({
			current: 'sellado-1',
			currentLabel: own.label,
			moving: false,
			next: null,
			done: 4,
			total: 10,
			problem: null
		});
		expect(row?.cleanupAt?.getTime()).toBe(now.getTime() + KEEP_COPIES_DAYS * 86_400_000);
		expect(await places.cleanupDue(now)).toEqual([]);
		expect(await places.cleanupDue(new Date(now.getTime() + 8 * 86_400_000))).toEqual(['A']);
		await places.cleaned('A');
		expect(await places.cleanupDue(new Date(now.getTime() + 8 * 86_400_000))).toEqual([]);
	});

	test('cancelled before arriving: back as if nothing, in Seilide', async () => {
		await places.start('A', own, 3);
		await places.cancel('A');
		expect(await places.of('A')).toBeNull();
		expect(await places.notInSeilide()).toEqual(new Set());
	});

	test('from its own to another; cancelled, it stays in its own', async () => {
		await places.start('A', own, 1);
		await places.finish('A');
		await places.start('A', other, 1);
		expect(await places.notInSeilide()).toEqual(new Set(['A']));
		await places.cancel('A');
		expect(await places.of('A')).toMatchObject({ current: 'sellado-1', moving: false });
		await places.start('A', other, 1);
		await places.finish('A');
		expect(await places.of('A')).toMatchObject({ current: 'sellado-2', currentLabel: other.label });
	});

	test('other keys: only once in its own', async () => {
		await places.setKeys('A', 'x', 'y');
		expect(await places.of('A')).toBeNull();
		await places.start('A', own, 0);
		await places.finish('A');
		await places.setKeys('A', 'sellado-3', own.label);
		expect((await places.of('A'))?.current).toBe('sellado-3');
	});

	test("the administrator's way back: the row goes", async () => {
		await places.start('A', own, 0);
		await places.finish('A');
		await places.start('A', null, 0);
		await places.finish('A');
		expect(await places.of('A')).toBeNull();
	});

	test("one family's never seen from another", async () => {
		await places.start('B', own, 0);
		expect(await places.of('A')).toBeNull();
		await places.cancel('A');
		expect((await places.all()).map((r) => r.familyId)).toEqual(['B']);
	});
});
