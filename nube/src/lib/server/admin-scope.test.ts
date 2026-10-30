import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { backupRun, family, house, session, user, waitlist } from './db/schema.ts';
import { adminScope } from './admin-scope.ts';

/**
 * /admin's counts through row-level security (family.schema.ts, `adminReads`) as the app's role,
 * and the copies' reports (deploy/vps-backup.sh), on PGlite as family-scope.test.ts.
 */
const db = drizzle(new PGlite(), { schema });
const admin = adminScope(db, { role: 'app_user' });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);

	await db.insert(user).values(['ana', 'berta', 'carla'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(house).values({ familyId: 'A', url: 'https://a.test', key: 'k' });
	const s = (id: string, userId: string, updatedAt: Date) => ({
		id,
		token: id,
		userId,
		createdAt: updatedAt,
		updatedAt,
		expiresAt: new Date(Date.now() + 86400000)
	});
	await db
		.insert(session)
		.values([
			s('s1', 'ana', hoursAgo(1)),
			s('s2', 'ana', hoursAgo(2)),
			s('s3', 'berta', hoursAgo(24 * 60))
		]);
	await db.insert(waitlist).values([
		{ id: 'w1', email: 'x@test.es', name: 'X' },
		{ id: 'w2', email: 'y@test.es', name: 'Y', status: 'approved' }
	]);
});

describe('counts', () => {
	test('every family, as the app’s role', async () => {
		expect(await admin.counts()).toEqual({
			families: 2,
			houses: 1,
			users: 3,
			active: 1,
			waiting: 1
		});
	});

	test('without app.is_admin, the families’ tables give nothing', async () => {
		const n = await db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			return tx.select().from(family);
		});
		expect(n).toHaveLength(0);
	});
});

describe('backups', () => {
	test('good, failed and late', async () => {
		await db.insert(backupRun).values([
			{ name: 'seilide', ok: true, log: 'Subida a', createdAt: hoursAgo(1) },
			{ name: 'seilide', ok: true, log: 'Subida b', createdAt: hoursAgo(25) },
			{ name: 'langua', ok: false, log: 'pg_dump: error', createdAt: hoursAgo(2) },
			{ name: 'langua', ok: true, log: 'Subida', createdAt: hoursAgo(26) },
			{ name: 'scholio', ok: true, log: 'Subida', createdAt: hoursAgo(30) }
		]);
		const byName = Object.fromEntries((await admin.backups()).map((b) => [b.name, b]));
		expect(byName.seilide.alarm).toBe(false);
		expect(byName.seilide.runs.map((r) => r.log)).toEqual(['Subida a', 'Subida b']);
		expect(byName.langua.alarm).toBe(true);
		expect(byName.langua.lastOk?.log).toBe('Subida');
		expect(byName.scholio.alarm).toBe(true);
	});

	test('a report is kept; those of over a month, gone', async () => {
		await db
			.insert(backupRun)
			.values({ name: 'old', ok: true, log: '', createdAt: hoursAgo(24 * 40) });
		await admin.recordBackup({ name: 'librarian', ok: true, log: 'Subida' });
		const names = (await admin.backups()).map((b) => b.name);
		expect(names).toContain('librarian');
		expect(names).not.toContain('old');
	});
});
