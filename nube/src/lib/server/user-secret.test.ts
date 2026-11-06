import { beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user, userDataKey, userSecret } from './db/schema.ts';
import type { Kms } from './envelope.ts';
import { userScope } from './family-scope.ts';
import { userSecrets } from './user-secret-scope.ts';

/**
 * A person's secrets (#428), on a real Postgres with RLS as the app's role, and a fake KMS that
 * "wraps" by prefixing who it is bound to, refusing another, as Key Manager's associated data does.
 */
const db = drizzle(new PGlite(), { schema });
const asUser = userScope(db, { role: 'app_user' });

const kms: Kms = {
	wrap: async (key, bound) => `${bound}|${key.toString('base64')}`,
	async unwrap(wrapped, bound) {
		const [owner, key] = wrapped.split('|');
		if (owner !== bound) throw new Error('Otra persona');
		return Buffer.from(key!, 'base64');
	}
};
const plain = {
	encrypt: (text: string) => `plano:${text}`,
	decrypt: (value: string) => value.replace('plano:', '')
};
const withKms = userSecrets({ asUser, kms: async () => kms, plain });
const withoutKms = userSecrets({ asUser, kms: null, plain });

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(
		['ana', 'bea', 'cris'].map((id) => ({
			id,
			name: id,
			email: `${id}@example.org`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
	await db.insert(family).values([
		{ id: 'f1', name: 'Una' },
		{ id: 'f2', name: 'Otra' }
	]);
	await db.insert(familyMember).values({ userId: 'ana', familyId: 'f1' });
});

const stored = async (userId: string) =>
	(await db.select().from(userSecret).where(eq(userSecret.userId, userId)))[0]?.value;

test('kept with their own key, never as it came, and read back', async () => {
	await withKms.set('ana', 'miniflux', 'la-clave');
	const value = await stored('ana');
	expect(value?.startsWith('kms1.')).toBe(true);
	expect(value).not.toContain('la-clave');
	expect(await withKms.get('ana', 'miniflux')).toBe('la-clave');
	const [key] = await db.select().from(userDataKey).where(eq(userDataKey.userId, 'ana'));
	expect(key?.wrapped.startsWith('user:ana|')).toBe(true);
});

test('it does not depend on the family: the same after changing it, or without one', async () => {
	await db.update(familyMember).set({ familyId: 'f2' }).where(eq(familyMember.userId, 'ana'));
	expect(await withKms.get('ana', 'miniflux')).toBe('la-clave');
	await db.delete(familyMember).where(eq(familyMember.userId, 'ana'));
	expect(await withKms.get('ana', 'miniflux')).toBe('la-clave');
});

test('another person sees no row of theirs, nor without saying who asks', async () => {
	const rows = await asUser('bea', async (tx) => ({
		secrets: await tx.select().from(userSecret),
		keys: await tx.select().from(userDataKey)
	}));
	expect(rows).toEqual({ secrets: [], keys: [] });
	expect(await withKms.get('bea', 'miniflux')).toBeNull();
	const none = await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('role', 'app_user', true)`);
		return tx.select().from(userSecret);
	});
	expect(none).toEqual([]);
});

test('another person cannot write as them', async () => {
	await expect(
		asUser('bea', (tx) => tx.insert(userSecret).values({ userId: 'ana', name: 'x', value: 'y' }))
	).rejects.toThrow();
});

test('a copied row cannot be opened as another person’s', async () => {
	const value = (await stored('ana'))!;
	await withKms.set('bea', 'miniflux', 'la-de-bea');
	await db.update(userSecret).set({ value }).where(eq(userSecret.userId, 'bea'));
	expect(await withKms.get('bea', 'miniflux')).toBeNull();
});

test('replaced, then forgotten', async () => {
	await withKms.set('ana', 'miniflux', 'otra');
	expect(await withKms.get('ana', 'miniflux')).toBe('otra');
	await withKms.set('ana', 'miniflux', null);
	expect(await withKms.get('ana', 'miniflux')).toBeNull();
});

test('without the KMS, the plain way; with it on later, still read', async () => {
	await withoutKms.set('cris', 'miniflux', 'sin-kms');
	expect(await stored('cris')).toBe('plano:sin-kms');
	expect(await withKms.get('cris', 'miniflux')).toBe('sin-kms');
});

test('kept with the KMS and the KMS gone: nothing, not a failure', async () => {
	await withKms.set('cris', 'miniflux', 'con-kms');
	expect(await withoutKms.get('cris', 'miniflux')).toBeNull();
});

test('gone with the account', async () => {
	await db.delete(user).where(eq(user.id, 'cris'));
	expect(await stored('cris')).toBeUndefined();
	expect(await db.select().from(userDataKey).where(eq(userDataKey.userId, 'cris'))).toEqual([]);
});
