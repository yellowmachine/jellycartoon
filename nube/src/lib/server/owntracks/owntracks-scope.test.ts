import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { gte, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { locationPoint, owntracksLink, user } from '../db/schema.ts';
import { userScope } from '../family-scope.ts';
import { walkingOutings } from '#lib/owntracks-walking.ts';
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
const utcDay = (at: Date) => at.toISOString().slice(0, 10);
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
		await ot.save('ana', point(5), utcDay);
		await ot.save('ana', point(1), utcDay);
		await ot.save('ana', point(1), utcDay);
		await ot.save('luis', point(3), utcDay);
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

	test('a phone sending every second: one kept every 10 s, late ones too', async () => {
		const at = (s: number) => ({
			...point(30),
			lat: 38 + s / 1000,
			at: new Date(Date.UTC(2026, 10, 22, 11, 0, s))
		});
		const kept = [];
		for (let s = 0; s < 25; s++) kept.push(await ot.save('luis', at(s), utcDay));
		expect(kept.filter(Boolean).length).toBe(3); // 0, 10 and 20
		expect(await ot.save('luis', at(-5), utcDay)).toBe(false); // queued, 5 s before
		expect(await ot.save('luis', at(-10), utcDay)).toBe(true);
		expect(await ot.save('ana', at(5), utcDay)).toBe(true); // someone else's
		const all = await ot.between(
			'luis',
			new Date(Date.UTC(2026, 10, 22, 10, 59)),
			new Date(Date.UTC(2026, 10, 22, 12))
		);
		expect(all.map((p) => p.at.getUTCSeconds())).toEqual([50, 0, 10, 20]);
		await asUser('luis', (tx) =>
			tx
				.delete(locationPoint)
				.where(gte(locationPoint.at, new Date(Date.UTC(2026, 10, 22, 10, 59))))
		);
		await asUser('ana', (tx) =>
			tx.delete(locationPoint).where(gte(locationPoint.at, new Date(Date.UTC(2026, 10, 22, 11))))
		);
	});

	test('standing still, only its first and last; leaving, late ones and another day', async () => {
		await db.insert(user).values(person('eva'));
		/** Metres north of home, at a time. */
		const at = (time: string, metres = 0, accuracy = 10, day = '22') => ({
			...point(0),
			at: new Date(`2026-11-${day}T${time}Z`),
			lat: 37.98 + metres / 111_195,
			accuracy
		});
		const save = (p: ReturnType<typeof at>) => ot.save('eva', p, utcDay);
		const kept = async () =>
			(await ot.between('eva', new Date('2026-11-01'), new Date('2026-12-01'))).map(
				(p) =>
					`${p.at.toISOString().slice(8, 16)} ${Math.round((p.lat - 37.98) * 111_195)} ${p.accuracy}`
			);
		await save(at('19:00:00'));
		await save(at('19:15:00', 12));
		await save(at('19:30:00', 20));
		expect(await kept()).toEqual(['22T19:00 0 10', '22T19:30 20 10']);
		// Inaccurate, indoors: still there, where it was known; not a move.
		await save(at('19:45:00', 80, 90));
		expect(await kept()).toEqual(['22T19:00 0 10', '22T19:45 20 10']);
		// Late, in the middle of the stay.
		expect(await save(at('19:20:00', 5))).toBe(false);
		// Late, and somewhere else: kept.
		expect(await save(at('19:25:00', 400))).toBe(true);
		await asUser('eva', (tx) => tx.delete(locationPoint).where(sql`${locationPoint.lat} > 37.982`));
		// Another day has its own first and last.
		await save(at('08:00:00', 0, 10, '23'));
		await save(at('08:04:00', 0, 10, '23'));
		await save(at('08:05:00', 0, 10, '23'));
		// Leaving: 40 m a minute, each one kept.
		await save(at('08:06:00', 40, 10, '23'));
		await save(at('08:07:00', 80, 10, '23'));
		expect(await kept()).toEqual([
			'22T19:00 0 10',
			'22T19:45 20 10',
			'23T08:00 0 10',
			'23T08:05 0 10',
			'23T08:06 40 10',
			'23T08:07 80 10'
		]);
	});

	test('walking slowly with Move is not standing still; a long stop cuts the outing', async () => {
		await db.insert(user).values(person('leo'));
		// 3 km/h for 15 min, 20 min stopped, 15 min more; one each 15 s.
		let metres = 0;
		const start = Date.UTC(2026, 10, 22, 9);
		for (let i = 0; i <= 200; i++) {
			if (i > 0 && (i <= 60 || i > 140)) metres += 12.5;
			const p = { ...point(0), at: new Date(start + i * 15_000), lat: 37.98 + metres / 111_195 };
			await ot.save('leo', p, utcDay);
		}
		const points = await ot.between('leo', new Date('2026-11-22'), new Date('2026-11-23'));
		expect(points.length).toBeLessThan(130);
		const outings = walkingOutings(points);
		expect(outings).toHaveLength(2);
		const sum = outings.reduce((s, o) => s + o.distance, 0);
		expect(Math.abs(sum - 1500)).toBeLessThan(60);
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
			await ot.save('ana', p, utcDay);
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
		await ot.save('ana', walkOn('2026-08-01')[0]!, utcDay);
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

describe('arrivals (phase 4)', () => {
	const arrive = (iso: string, place = 'Casa', moment: 'llega' | 'sale' = 'llega') => ({
		at: new Date(iso),
		place,
		moment
	});

	test("the same one sent twice, kept once; a day in order; only one's own", async () => {
		expect(await ot.saveTransition('ana', arrive('2026-11-22T19:42:00Z'))).toBe(true);
		expect(await ot.saveTransition('ana', arrive('2026-11-22T19:42:00Z'))).toBe(false);
		expect(await ot.saveTransition('ana', arrive('2026-11-22T08:10:00Z', 'Casa', 'sale'))).toBe(
			true
		);
		expect(await ot.saveTransition('luis', arrive('2026-11-22T12:00:00Z', 'Trabajo'))).toBe(true);
		const day = await ot.transitionsBetween(
			'ana',
			new Date('2026-11-22T00:00:00Z'),
			new Date('2026-11-23T00:00:00Z')
		);
		expect(day.map((a) => `${a.at.toISOString().slice(11, 16)} ${a.moment} ${a.place}`)).toEqual([
			'08:10 sale Casa',
			'19:42 llega Casa'
		]);
	});

	test('forgotten with the old days, and with «Borrar todo»', async () => {
		await ot.saveTransition('ana', arrive('2026-08-01T19:00:00Z'));
		await ot.summarizeOld('ana', '2026-08-25', {
			dayStart: (d) => new Date(`${d}T00:00:00Z`),
			dayOf: (at) => at.toISOString().slice(0, 10),
			nextDay: (d) =>
				new Date(new Date(`${d}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10),
			appWalks: async () => []
		});
		const all = (who: string) =>
			ot.transitionsBetween(
				who,
				new Date('2026-01-01T00:00:00Z'),
				new Date('2027-01-01T00:00:00Z')
			);
		expect((await all('ana')).map((a) => a.at.toISOString().slice(0, 10))).toEqual([
			'2026-11-22',
			'2026-11-22'
		]);
		await ot.forget('ana');
		expect(await all('ana')).toEqual([]);
		expect(await all('luis')).toHaveLength(1);
	});
});
