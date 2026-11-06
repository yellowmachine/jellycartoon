import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './db/schema.ts';
import { account, session, user } from './db/schema.ts';
import { closeSessionsOfThoseNotIn } from './nube-members-scope.ts';

/** On a real Postgres (PGlite), with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
const close = (adults: unknown) =>
	closeSessionsOfThoseNotIn(db, adults, {
		provider: 'nube',
		isAdmin: async (id) => id === 'admin'
	});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const open = (id: string, userId: string) => ({
	id,
	userId,
	token: id,
	expiresAt: new Date(Date.now() + 86_400_000),
	createdAt: new Date(),
	updatedAt: new Date()
});
const viaCloud = (userId: string) => ({
	id: userId,
	userId,
	accountId: `sub-${userId}`,
	providerId: 'nube',
	createdAt: new Date(),
	updatedAt: new Date()
});
const stillOpen = async () => (await db.select().from(session)).map((s) => s.userId).sort();

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

beforeEach(async () => {
	await db.delete(session);
	await db.delete(account);
	await db.delete(user);
	await db.insert(user).values(['admin', 'ana', 'luis', 'abuela'].map(person));
	await db.insert(account).values(['admin', 'ana', 'luis'].map(viaCloud));
	await db
		.insert(session)
		.values([
			open('1', 'admin'),
			open('2', 'ana'),
			open('3', 'luis'),
			open('4', 'luis'),
			open('5', 'abuela')
		]);
});

describe('whoever left the family in Seilide (#315)', () => {
	test('all their sessions end; those of the family stay, whatever the case of the email', async () => {
		expect(await close(['ANA@test.es'])).toBe(2);
		expect(await stillOpen()).toEqual(['abuela', 'admin', 'ana']);
	});

	test('the house’s administrator stays, though Seilide does not know them', async () => {
		await close(['ana@test.es']);
		expect(await stillOpen()).toContain('admin');
	});

	test('someone who never entered with Seilide is the house’s, and stays', async () => {
		await close(['ana@test.es']);
		expect(await stillOpen()).toContain('abuela');
	});

	test('their account stays: their history is the house’s', async () => {
		await close(['ana@test.es']);
		expect((await db.select().from(user)).map((u) => u.id)).toContain('luis');
	});

	test('with everyone still there, nothing', async () => {
		expect(await close(['ana@test.es', 'luis@test.es'])).toBe(0);
	});
});

describe('without a good answer, nothing changes (#315)', () => {
	test.each([
		['no list', undefined],
		['an empty list', []],
		['not a list', 'ana@test.es'],
		['nothing', null]
	])('%s', async (_, adults) => {
		expect(await close(adults)).toBe(0);
		expect(await stillOpen()).toEqual(['abuela', 'admin', 'ana', 'luis', 'luis']);
	});
});
