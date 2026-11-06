import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { adminsAndAdults, handOverAdmin } from './family-role.ts';
import { familyScope } from './family-scope.ts';

/** On a real Postgres (PGlite), as the app's role, to which row-level security applies. */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

const roles = async () =>
	Object.fromEntries(
		(await db.select().from(familyMember)).map((m) => [m.userId, m.role] as const)
	);

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(['ana', 'luis', 'eva', 'peque', 'berta'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
});

beforeEach(async () => {
	await db.delete(familyMember);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'eva', familyId: 'A', role: 'member' },
		{ userId: 'peque', familyId: 'A', role: 'peque' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
});

describe('handing over the administration (#315)', () => {
	test('the other adult administers, and whoever gave it no longer does', async () => {
		expect(await handOverAdmin(withFamily, 'ana', 'luis')).toEqual({
			ok: true,
			name: 'luis',
			email: 'luis@test.es',
			fromName: 'ana',
			familyName: 'Casa A'
		});
		expect(await roles()).toMatchObject({ ana: 'member', luis: 'admin', eva: 'member' });
	});

	test('only whoever administers can', async () => {
		const done = await handOverAdmin(withFamily, 'luis', 'eva');
		expect(done.ok).toBe(false);
		expect(await roles()).toMatchObject({ ana: 'admin', luis: 'member', eva: 'member' });
	});

	test('not to a child, nor to oneself', async () => {
		expect((await handOverAdmin(withFamily, 'ana', 'peque')).ok).toBe(false);
		expect((await handOverAdmin(withFamily, 'ana', 'ana')).ok).toBe(false);
		expect(await roles()).toMatchObject({ ana: 'admin', peque: 'peque' });
	});

	test('not to someone of another family, who stays as they were', async () => {
		expect((await handOverAdmin(withFamily, 'ana', 'berta')).ok).toBe(false);
		expect(await roles()).toMatchObject({ ana: 'admin', berta: 'admin' });
	});

	test('not to someone who already administers: the family would be left with fewer', async () => {
		await db.execute(sql`update family_member set role = 'admin' where user_id = 'luis'`);
		expect((await handOverAdmin(withFamily, 'ana', 'luis')).ok).toBe(false);
		expect(await roles()).toMatchObject({ ana: 'admin', luis: 'admin' });
	});

	test('it says who administers and who could, of its family only', async () => {
		expect(await adminsAndAdults(withFamily, 'ana')).toEqual({
			admins: [{ id: 'ana', name: 'ana' }],
			others: [
				{ id: 'eva', name: 'eva' },
				{ id: 'luis', name: 'luis' }
			]
		});
	});
});
