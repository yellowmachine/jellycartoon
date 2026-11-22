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

describe('the old days (phase 3)', () => {
	const day = (d: string) => new Date(`${d}T00:00:00Z`);
	const nextDay = (d: string) => {
		const x = day(d);
		x.setUTCDate(x.getUTCDate() + 1);
		return x.toISOString().slice(0, 10);
	};
	const options = (walks: { startedAt: Date; endedAt: Date }[] = []) => ({
		dayStart: day,
		dayOf: (at: Date) => at.toISOString().slice(0, 10),
		nextDay,
		appWalks: async () => walks
	});
	/** Half an hour at 5 km/h from 9:00 that day, a position each minute. */
	const walkOn = (d: string) =>
		Array.from({ length: 31 }, (_, i) => ({
			at: new Date(day(d).getTime() + (9 * 60 + i) * 60_000),
			lon: -1.13,
			lat: 37.98 + ((5000 / 60) * i) / 111_195,
			accuracy: 10,
			speed: null,
			altitude: null,
			battery: null,
			device: null
		}));

	test('summed up by day, then forgotten; the days kept, untouched', async () => {
		for (const p of [...walkOn('2026-08-01'), ...walkOn('2026-08-03'), ...walkOn('2026-11-20')])
			await ot.save('ana', p);
		// An app walk over half of 3 August: that half is not counted.
		const appWalk = {
			startedAt: new Date('2026-08-03T09:15:00Z'),
			endedAt: new Date('2026-08-03T10:00:00Z')
		};
		expect(await ot.summarizeOld('ana', '2026-08-25', options([appWalk]))).toBe(2);

		const first = await ot.summaryOf('ana', '2026-08-01');
		expect(first).toMatchObject({ outings: 1, points: 31, seconds: 1800 });
		expect(first!.distance).toBeCloseTo(2500, -1);
		expect((await ot.summaryOf('ana', '2026-08-03'))!.distance).toBeCloseTo(1250, -1);
		expect(await ot.summaryOf('ana', '2026-08-02')).toBeNull();

		const left = await ot.between('ana', day('2026-01-01'), day('2027-01-01'));
		expect(left).toHaveLength(31);
		expect(await ot.firstDay('ana', options().dayOf)).toBe('2026-08-01');
		expect((await ot.status('ana')).kept).toBe(true);
	});

	test('a position of a summed-up day that comes late does not spoil it', async () => {
		await ot.save('ana', walkOn('2026-08-01')[0]!);
		expect(await ot.summarizeOld('ana', '2026-08-25', options())).toBe(1);
		expect((await ot.summaryOf('ana', '2026-08-01'))!.points).toBe(31);
		expect(await ot.summarizeOld('ana', '2026-08-25', options())).toBe(0);
	});

	test("forget takes the summaries too, and only one's own", async () => {
		await ot.forget('ana');
		expect(await ot.summaryOf('ana', '2026-08-01')).toBeNull();
		expect((await ot.status('ana')).kept).toBe(false);
		expect(await ot.firstDay('ana', options().dayOf)).toBeNull();
	});
});
