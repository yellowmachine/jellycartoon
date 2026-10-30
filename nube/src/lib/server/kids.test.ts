import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, familyPerson, kidAccount, user } from './db/schema.ts';
import { familyOnlyScope, familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import { NoFamily } from './family-scope.ts';

/**
 * Children's accounts (#303), on a real Postgres (PGlite) as the app's role, with Better Auth's
 * own user and credential faked: given to a person without one, its adults, and taken back.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
// The whole module, as kid-login.test.ts's: a mock is the process's, whichever test runs first.
mock.module('#lib/server/family.ts', () => ({
	withFamily,
	asFamily: familyOnlyScope(db, { role: 'app_user' }),
	NoFamily
}));
mock.module('#lib/server/secret-box.ts', () => ({
	encrypt: (text: string) => `cifrado:${text}`,
	decrypt: (text: string) => text
}));
let made = 0;
mock.module('#lib/server/auth.ts', () => ({
	auth: {
		$context: Promise.resolve({
			password: { hash: async (p: string) => `hash:${p}` },
			internalAdapter: {
				createUser: async (u: { email: string; name: string }) => {
					const [row] = await db
						.insert(user)
						.values({
							id: `peque${++made}`,
							...u,
							createdAt: new Date(),
							updatedAt: new Date()
						})
						.returning();
					return row;
				},
				linkAccount: async () => {},
				deleteUser: async (id: string) => void (await db.delete(user).where(eq(user.id, id)))
			}
		}),
		// kid-login.test.ts's, unused here.
		api: {}
	}
}));

const {
	familyAdults,
	familyKids,
	giveKidAccount,
	isKidAccount,
	kidMayOpen,
	setGuardians,
	takeKidAccount
} = await import('./kids.ts');

const kitchen = (userId: string): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana');

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

let lucia = 0;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'alberto', 'otra'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' },
		{ userId: 'otra', familyId: 'B', role: 'admin' }
	]);
	[{ id: lucia }] = await db
		.insert(familyPerson)
		.values({ familyId: 'A', name: 'Lucía', avatar: 'zorro' })
		.returning({ id: familyPerson.id });
});

describe('a child account', () => {
	test('given to a person without one: only its family’s adults let it in', async () => {
		expect(await giveKidAccount(ana, lucia, ['ana', 'otra'])).toBe(true);
		const [kid] = await familyKids(ana);
		expect(kid).toMatchObject({ personId: lucia, guardians: ['ana'] });
		const [account] = await db.select().from(user).where(eq(user.id, kid.id));
		expect(account).toMatchObject({ name: 'Lucía' });
		expect(account.email).toEndWith('@peques.invalid');
		const [secret] = await db.select().from(kidAccount).where(eq(kidAccount.userId, kid.id));
		expect(secret.secret).toStartWith('cifrado:');
		expect(await isKidAccount(kid.id)).toBe(true);
		expect(await isKidAccount('ana')).toBe(false);
		// Not an adult who lets others in.
		expect((await familyAdults(ana)).map((a) => a.id)).toEqual(['alberto', 'ana']);
	});

	test('not twice, nor to another family’s person', async () => {
		expect(await giveKidAccount(ana, lucia, [])).toBe(false);
		expect(await giveKidAccount(kitchen('otra'), lucia, [])).toBe(false);
	});

	test('its adults, changed', async () => {
		const [kid] = await familyKids(ana);
		expect(await setGuardians(ana, kid.id, ['alberto', 'ana'])).toBe(true);
		expect((await familyKids(ana))[0].guardians.sort()).toEqual(['alberto', 'ana']);
	});

	test('taken back: a person without one again, with its name and drawing', async () => {
		const [kid] = await familyKids(ana);
		expect(await takeKidAccount(ana, kid.id)).toBe(true);
		expect(await familyKids(ana)).toEqual([]);
		const [row] = await db.select().from(familyPerson).where(eq(familyPerson.id, lucia));
		expect(row).toMatchObject({ userId: null, name: 'Lucía', avatar: 'zorro' });
	});
});

describe('where a child may go', () => {
	test('its agenda (only to look), the fridge, homework and its way out', () => {
		expect(kidMayOpen('/', 'GET')).toBe(true);
		expect(kidMayOpen('/agenda', 'GET')).toBe(true);
		expect(kidMayOpen('/agenda', 'POST')).toBe(false);
		expect(kidMayOpen('/agenda/alarmas', 'GET')).toBe(false);
		expect(kidMayOpen('/nevera', 'POST')).toBe(true);
		expect(kidMayOpen('/api/nevera/notas', 'GET')).toBe(true);
		expect(kidMayOpen('/deberes/3', 'GET')).toBe(true);
		// Series and music: the house gives it only what is for children.
		expect(kidMayOpen('/series', 'GET')).toBe(true);
		expect(kidMayOpen('/watch/12', 'GET')).toBe(true);
		expect(kidMayOpen('/musica/listas', 'GET')).toBe(true);
	});
	test('nothing else', () => {
		for (const path of ['/gastos', '/ajustes', '/voz', '/viajes', '/api/gastos', '/api/music/dj'])
			expect(kidMayOpen(path, 'GET')).toBe(false);
		expect(kidMayOpen('/neveras', 'GET')).toBe(false);
	});
});
