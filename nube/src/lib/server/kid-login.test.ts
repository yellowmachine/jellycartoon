import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import * as schema from './db/schema.ts';
import {
	family,
	familyMember,
	familyPerson,
	kidAccount,
	kidGuardian,
	session,
	user
} from './db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Children entering with an adult's permission (#303), on a real Postgres (PGlite) as the app's
 * role: the family's device, the request, its adults' answer, and the session it gets. Better
 * Auth's sign-in, the phones' notices and the encryption, faked.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
mock.module('#lib/server/db/index.ts', () => ({ db }));
// The whole module, as kids.test.ts's: a mock is the process's, whichever test runs first.
mock.module('#lib/server/family.ts', () => ({ withFamily, asFamily, NoFamily }));
mock.module('#lib/server/secret-box.ts', () => ({
	encrypt: (text: string) => text,
	decrypt: (text: string) => text
}));
const told: { to: string[]; title: string }[] = [];
mock.module('#lib/server/push.ts', () => ({
	notify: async (_: string, to: string[], m: { title: string }) => void told.push({ to, ...m })
}));
const signedIn: string[] = [];
const signedOut: string[] = [];
mock.module('#lib/server/auth.ts', () => ({
	auth: {
		api: {
			signInEmail: async ({ body }: { body: { email: string; password: string } }) => {
				const [kid] = await db.select().from(user).where(eq(user.email, body.email));
				if (body.password !== `clave-${kid.id}`) throw new Error('Contraseña');
				const token = `sesion-${signedIn.length}`;
				await db.insert(session).values({
					id: token,
					token,
					userId: kid.id,
					expiresAt: new Date(Date.now() + 7 * 86_400_000),
					createdAt: new Date(),
					updatedAt: new Date()
				});
				signedIn.push(kid.id);
				return { token };
			},
			signOut: async () => void signedOut.push('fuera')
		},
		// kids.test.ts's, unused here.
		$context: Promise.resolve({})
	}
}));

const login = await import('./kid-login.ts');

/** A browser's cookies, as SvelteKit's. */
function jar(): Cookies {
	const values = new Map<string, string>();
	return {
		get: (name: string) => values.get(name),
		set: (name: string, value: string) => void values.set(name, value),
		delete: (name: string) => void values.delete(name)
	} as unknown as Cookies;
}

const kitchen = (familyId: string, userId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('A', 'ana');
const alberto = kitchen('A', 'alberto');

const person = (id: string, email = `${id}@test.es`) => ({
	id,
	name: id,
	email,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db
		.insert(user)
		.values([
			person('ana'),
			person('alberto'),
			person('otra'),
			person('lucia', 'lucia@peques.invalid')
		]);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' },
		{ userId: 'otra', familyId: 'B', role: 'admin' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' }
	]);
	await db.insert(familyPerson).values({ familyId: 'A', userId: 'lucia', name: 'Lucía' });
	await db.insert(kidAccount).values({ userId: 'lucia', familyId: 'A', secret: 'clave-lucia' });
	// Only Alberto lets her in.
	await db.insert(kidGuardian).values({ familyId: 'A', kidId: 'lucia', guardianId: 'alberto' });
});

const tablet = jar();

describe('the family’s device', () => {
	test('marked here: known by its cookie, with its family', async () => {
		expect(await login.deviceOf(tablet)).toBeNull();
		await login.trustDevice(ana, tablet, 'La tablet');
		expect(await login.deviceOf(tablet)).toMatchObject({ familyId: 'A', name: 'La tablet' });
		expect((await login.pickableKids('A')).map((k) => k.name)).toEqual(['lucia']);
	});
	test('a cookie made up for another family is nobody’s', async () => {
		const other = jar();
		other.set('seilide-peques', `B.${tablet.get('seilide-peques')!.split('.')[1]}`, { path: '/' });
		expect(await login.deviceOf(other)).toBeNull();
	});
});

describe('asking to enter', () => {
	test('its adults are told, and only they may answer', async () => {
		const device = (await login.deviceOf(tablet))!;
		const asked = await login.askToEnter(device, 'lucia');
		expect(asked).toHaveProperty('requestId');
		const { requestId } = asked as { requestId: string };
		// Told on their phones meanwhile, without the device waiting for it.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(told.at(-1)).toMatchObject({ to: ['alberto'], title: 'lucia quiere entrar' });
		expect(await login.pendingFor(ana)).toEqual([]);
		expect((await login.pendingFor(alberto)).map((p) => p.id)).toEqual([requestId]);
		expect(await login.decide(ana, requestId, '1h')).toBe('not-found');
		expect(await login.decide(alberto, requestId, '1h')).toBe('approved');
		expect(await login.decide(alberto, requestId, 'no')).toBe('late');
		// In, until the permission ends.
		const entered = await login.enter(device, { requestId });
		expect(entered?.kidId).toBe('lucia');
		const [s] = await db.select().from(session).where(eq(session.userId, 'lucia'));
		expect(s.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
		// The request, used up.
		expect(await login.enter(device, { requestId })).toBeNull();
	});
	test('with «1 hora» running there, it enters again without asking', async () => {
		const device = (await login.deviceOf(tablet))!;
		expect(await login.askToEnter(device, 'lucia')).toEqual({ permit: true });
		expect(await login.enter(device, { kidId: 'lucia' })).toMatchObject({ kidId: 'lucia' });
	});
	test('another family’s device cannot ask for her', async () => {
		const theirs = jar();
		await login.trustDevice(kitchen('B', 'otra'), theirs, 'Su tablet');
		const device = (await login.deviceOf(theirs))!;
		expect(await login.askToEnter(device, 'lucia')).toEqual({ error: 'No encontrado' });
		expect(await login.enter(device, { kidId: 'lucia' })).toBeNull();
	});
});

describe('«Pasar a…»', () => {
	test('only who lets her in hands her their phone', async () => {
		expect(await login.kidsOf(ana)).toEqual([]);
		expect((await login.kidsOf(alberto)).map((k) => k.id)).toEqual(['lucia']);
		expect(await login.handOver(ana, 'lucia', 'today', new Headers())).toBeNull();
		const before = signedIn.length;
		expect(await login.handOver(alberto, 'lucia', '2h', new Headers())).toMatchObject({
			kidId: 'lucia'
		});
		expect(signedOut).toHaveLength(1);
		expect(signedIn).toHaveLength(before + 1);
	});
});
