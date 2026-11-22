import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { locationPoint, owntracksLink, user } from '../db/schema.ts';
import { userScope } from '../family-scope.ts';
import { owntracksScope } from './owntracks-scope.ts';

/** OwnTracks (#593) on a real Postgres (PGlite), as the app's role: each one's, and by password. */
const db = drizzle(new PGlite(), { schema });
const ot = owntracksScope(db, { role: 'app_user' });
const asUser = userScope(db, { role: 'app_user' });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const point = (minute: number) => ({
	at: new Date(Date.UTC(2026, 10, 22, 10, minute)),
	lon: -1.13,
	lat: 37.98 + minute / 1000,
	accuracy: 10,
	speed: 4,
	altitude: null,
	battery: 80 - minute,
	device: 'pixel'
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(['ana', 'luis'].map(person));
});

describe('OwnTracks', () => {
	test('a password says whose, kept only as its hash; a new one replaces it', async () => {
		const first = await ot.connect('ana');
		expect(await ot.userOf(first)).toBe('ana');
		const [row] = await db.select().from(owntracksLink);
		expect(row!.tokenHash).not.toBe(first);
		const second = await ot.connect('ana');
		expect(await ot.userOf(second)).toBe('ana');
		expect(await ot.userOf(first)).toBeNull();
		expect(await ot.userOf('x'.repeat(43))).toBeNull();
		expect(await ot.userOf('corto')).toBeNull();
		expect(await ot.userOf(null)).toBeNull();
	});

	test("positions: the same moment once, a day in order, only one's own", async () => {
		await ot.save('ana', point(5));
		await ot.save('ana', point(1));
		await ot.save('ana', point(1));
		await ot.save('luis', point(3));
		const day = await ot.between(
			'ana',
			new Date(Date.UTC(2026, 10, 22)),
			new Date(Date.UTC(2026, 10, 23))
		);
		expect(day.map((p) => p.at.getUTCMinutes())).toEqual([1, 5]);
		// Luis sees nothing of Ana's, even asking for her rows.
		const seen = await asUser('luis', (tx) => tx.select().from(locationPoint));
		expect(seen.map((p) => p.userId)).toEqual(['luis']);
	});

	test('status, disconnect and forget', async () => {
		const s = await ot.status('ana');
		expect(s.connectedAt).toBeInstanceOf(Date);
		expect(s.last).toMatchObject({ battery: 75, device: 'pixel' });
		expect((await ot.status('luis')).connectedAt).toBeNull();

		await ot.disconnect('ana');
		const after = await ot.status('ana');
		expect(after.connectedAt).toBeNull();
		expect(after.last).not.toBeNull();

		await ot.forget('ana');
		expect((await ot.status('ana')).last).toBeNull();
		expect((await ot.status('luis')).last).not.toBeNull();
	});
});
