import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, storageQuota, storedFile } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import { fileQuotaScope } from './file-quota-scope.ts';

/** Each family's storage quota (#480), through row-level security as the app's role, on PGlite. */
const db = drizzle(new PGlite(), { schema });
const quota = fileQuotaScope(db, { role: 'app_user', defaultBytes: 1000 });
const asFamily = familyOnlyScope(db, { role: 'app_user' });

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
	await db.delete(storedFile);
	await db.delete(storageQuota);
});

describe('room', () => {
	test('a file fits until the quota, and not past it', async () => {
		await quota.kept('A', 'fotos', 'a.jpg', 600);
		expect((await quota.room('A', 'fotos', 'b.jpg', 400)).fits).toBe(true);
		expect((await quota.room('A', 'fotos', 'b.jpg', 401)).fits).toBe(false);
	});

	test('the file it replaces is not counted twice', async () => {
		await quota.kept('A', 'fotos', 'a.jpg', 900);
		expect((await quota.room('A', 'fotos', 'a.jpg', 1000)).fits).toBe(true);
		await quota.kept('A', 'fotos', 'a.jpg', 1000);
		expect((await quota.usage('A')).used).toBe(1000);
	});

	test('the waiting phrases are not counted nor refused', async () => {
		await quota.kept('A', 'frases-espera', 'x.wav', 5000);
		expect((await quota.usage('A')).used).toBe(0);
		expect((await quota.room('A', 'fotos', 'a.jpg', 1000)).fits).toBe(true);
		expect((await quota.room('A', 'frases-espera', 'y.wav', 5000)).fits).toBe(true);
	});

	test('the warning only when crossing 80 %', async () => {
		await quota.kept('A', 'notas', 'a.webm', 700);
		expect((await quota.room('A', 'notas', 'b.webm', 99)).crossesWarning).toBe(false);
		expect((await quota.room('A', 'notas', 'b.webm', 100)).crossesWarning).toBe(true);
		await quota.kept('A', 'notas', 'b.webm', 100);
		expect((await quota.room('A', 'notas', 'c.webm', 50)).crossesWarning).toBe(false);
	});

	test("another family's files do not count", async () => {
		await quota.kept('B', 'fotos', 'a.jpg', 1000);
		expect((await quota.room('A', 'fotos', 'a.jpg', 1000)).fits).toBe(true);
	});
});

describe('usage and forgetting', () => {
	test('by area, the biggest first', async () => {
		await quota.kept('A', 'fotos', 'a.jpg', 100);
		await quota.kept('A', 'papeles', 'p1', 300);
		await quota.kept('A', 'papeles', 'p2', 50);
		expect(await quota.usage('A')).toEqual({
			used: 450,
			limit: 1000,
			areas: [
				{ area: 'papeles', bytes: 350, files: 2 },
				{ area: 'fotos', bytes: 100, files: 1 }
			]
		});
	});

	test('a file removed, and all of a family, only its own', async () => {
		await quota.kept('A', 'fotos', 'a.jpg', 100);
		await quota.kept('A', 'fotos', 'b.jpg', 100);
		await quota.kept('B', 'fotos', 'a.jpg', 100);
		await quota.forgotten('A', 'fotos', 'a.jpg');
		expect((await quota.usage('A')).used).toBe(100);
		await quota.forgottenAll('A');
		expect((await quota.usage('A')).used).toBe(0);
		expect((await quota.usage('B')).used).toBe(100);
	});
});

describe('the administrator', () => {
	test("a family's own quota, and back to the default", async () => {
		await quota.setLimit('A', 5000);
		expect((await quota.usage('A')).limit).toBe(5000);
		expect((await quota.usage('B')).limit).toBe(1000);
		await quota.setLimit('A', 5000 * 2);
		expect((await quota.usage('A')).limit).toBe(10000);
		await quota.setLimit('A', null);
		expect((await quota.usage('A')).limit).toBe(1000);
	});

	test('a family cannot change its own quota', async () => {
		const tried = asFamily('A', (tx) =>
			tx.insert(storageQuota).values({ familyId: 'A', bytes: 1e12 })
		);
		await expect(tried).rejects.toThrow();
		expect((await quota.usage('A')).limit).toBe(1000);
	});

	test('every family, the fullest first', async () => {
		await quota.kept('A', 'fotos', 'a.jpg', 100);
		await quota.kept('B', 'fotos', 'a.jpg', 900);
		await quota.setLimit('A', 200);
		expect(await quota.families()).toEqual([
			{ familyId: 'B', name: 'Casa B', used: 900, limit: 1000, custom: false },
			{ familyId: 'A', name: 'Casa A', used: 100, limit: 200, custom: true }
		]);
	});
});

describe('reconcile', () => {
	test('what is in the bucket comes in, what is not goes, unknown families skipped', async () => {
		await quota.kept('A', 'fotos', 'gone.jpg', 100);
		await quota.kept('A', 'fotos', 'kept.jpg', 10);
		const result = await quota.reconcile([
			{ familyId: 'A', area: 'fotos', name: 'kept.jpg', bytes: 20 },
			{ familyId: 'A', area: 'papeles', name: 'old', bytes: 300 },
			{ familyId: 'B', area: 'gastos', name: 't.jpg', bytes: 40 },
			{ familyId: 'Z', area: 'gastos', name: 't.jpg', bytes: 40 }
		]);
		expect(result).toEqual({ added: 3, removed: 1 });
		expect((await quota.usage('A')).used).toBe(320);
		expect((await quota.usage('B')).used).toBe(40);
		expect(await quota.reconcile([])).toEqual({ added: 0, removed: 3 });
	});
});
