import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './db/schema.ts';
import { family, familyMember, user, watchLog } from './db/schema.ts';
import type { Kitchen } from './fridge.ts';
import {
	forgetWatched,
	lastMondays,
	mondayOf,
	parseWatchRows,
	saveWatched,
	watchStats,
	type WatchRow
} from './watch-log.ts';

/** What is watched at home, on PGlite with the migrations as they are (#421). */
const db = drizzle(new PGlite(), { schema });
const k: Kitchen = { familyId: 'A', userId: null, run: (fn) => db.transaction((tx) => fn(tx)) };
const TODAY = '2026-11-06'; // A Friday.

const row = (over: Partial<WatchRow> = {}): WatchRow => ({
	day: TODAY,
	minute: 1270,
	item: 'e1',
	kind: 'serie',
	seriesTitle: 'Bluey',
	title: 'Capítulo',
	season: 1,
	number: 2,
	seconds: 300,
	...over
});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

beforeEach(async () => {
	await db.delete(watchLog);
	await db.delete(familyMember);
	await db.delete(family);
	await db.delete(user);
	await db.insert(user).values(['ana', 'luis', 'peque'].map(person));
	await db.insert(family).values({ id: 'A', name: 'A' });
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'peque', familyId: 'A', role: 'peque' }
	] as never);
});

test('sending the same slot again replaces it: nothing is added twice', async () => {
	await saveWatched(k, 'ana', [row()]);
	await saveWatched(k, 'ana', [row({ seconds: 420, title: 'Renombrado' })]);
	const rows = await db.select().from(watchLog);
	expect(rows.length).toBe(1);
	expect(rows[0]).toMatchObject({ seconds: 420, title: 'Renombrado', familyId: 'A' });
});

test('the same slot twice in one request is one, the last', async () => {
	await saveWatched(k, 'ana', [row(), row({ seconds: 500 })]);
	expect((await db.select().from(watchLog)).map((r) => r.seconds)).toEqual([500]);
});

test('forgetting takes only that person’s', async () => {
	await saveWatched(k, 'ana', [row()]);
	await saveWatched(k, 'peque', [row()]);
	await forgetWatched(k, 'ana');
	expect((await db.select().from(watchLog)).map((r) => r.userId)).toEqual(['peque']);
});

test('an adult sees their own and the children’s, never another adult’s', async () => {
	await saveWatched(k, 'ana', [row({ seconds: 600 })]);
	await saveWatched(k, 'luis', [row({ seconds: 6000, seriesTitle: 'De Luis' })]);
	await saveWatched(k, 'peque', [row({ seconds: 1200 })]);
	const stats = await watchStats(k, 'ana', TODAY, 4, null);
	expect(stats.people.map((p) => [p.id, p.seconds])).toEqual([
		['peque', 1200],
		['ana', 600]
	]);
	expect(stats.titles.map((t) => t.label)).toEqual(['Bluey']);
	expect(stats.titles[0].seconds).toBe(1800);
});

test('asking for another adult by the address gives the same as asking for no one', async () => {
	await saveWatched(k, 'ana', [row({ seconds: 600 })]);
	await saveWatched(k, 'luis', [row({ seconds: 6000, seriesTitle: 'De Luis' })]);
	const stats = await watchStats(k, 'ana', TODAY, 4, 'luis');
	expect(stats.person).toBeNull();
	expect(stats.titles.map((t) => t.label)).toEqual(['Bluey']);
});

test('one person: their weeks, hours and series; the list of people stays whole', async () => {
	await saveWatched(k, 'ana', [row({ seconds: 600 })]);
	await saveWatched(k, 'peque', [
		row({ seconds: 300, minute: 1270 }),
		row({ seconds: 120, minute: 1285, item: 'e2' }),
		row({
			seconds: 60,
			day: '2026-11-02',
			minute: 60,
			item: 'm1',
			kind: 'pelicula',
			seriesTitle: null,
			title: 'Peli',
			season: null,
			number: null
		}),
		row({ seconds: 900, day: '2026-10-26', minute: 60 })
	]);
	const stats = await watchStats(k, 'ana', TODAY, 2, 'peque');
	expect(stats.person).toBe('peque');
	expect(stats.people.length).toBe(2);
	expect(stats.weeks).toEqual([
		{ monday: '2026-10-26', seconds: 900 },
		{ monday: '2026-11-02', seconds: 480 }
	]);
	expect(stats.hours[21].seconds).toBe(420);
	expect(stats.hours[1].seconds).toBe(960);
	expect(stats.titles).toEqual([
		{ label: 'Bluey', kind: 'serie', seconds: 1320 },
		{ label: 'Peli', kind: 'pelicula', seconds: 60 }
	]);
});

test('what is older than the period does not count', async () => {
	await saveWatched(k, 'ana', [row({ day: '2026-10-25' })]);
	const stats = await watchStats(k, 'ana', TODAY, 2, null);
	expect(stats.people[0].seconds).toBe(0);
	expect(stats.titles).toEqual([]);
});

test('weeks go from Monday, this one the last', () => {
	expect(mondayOf('2026-11-08')).toBe('2026-11-02');
	expect(mondayOf('2026-11-02')).toBe('2026-11-02');
	expect(lastMondays(TODAY, 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
});

test('what the house sends is checked as a whole', () => {
	expect(parseWatchRows([row()])).toEqual([row()]);
	for (const bad of [
		{ minute: 1440 },
		{ minute: 1.5 },
		{ seconds: -1 },
		{ seconds: 90_000 },
		{ seconds: Number.NaN },
		{ kind: 'otra' },
		{ title: ' ' },
		{ day: '6/11/2026' },
		{ day: '2026-13-40' },
		{ item: '' }
	])
		expect(parseWatchRows([row(), row(bad as Partial<WatchRow>)])).toBeNull();
	expect(parseWatchRows('nada')).toBeNull();
	expect(parseWatchRows(Array.from({ length: 501 }, () => row()))).toBeNull();
	expect(parseWatchRows([null])).toBeNull();
});
