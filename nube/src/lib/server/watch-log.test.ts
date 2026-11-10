import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './db/schema.ts';
import { family, familyMember, user, watchLog } from './db/schema.ts';
import type { Kitchen } from './fridge.ts';
import {
	addListened,
	forgetWatched,
	lastDays,
	lastMondays,
	mondayOf,
	parseWatchRows,
	saveWatched,
	setKeepsHistory,
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

test('the last days one by one, and what was watched in them, the latest first', async () => {
	await saveWatched(k, 'peque', [
		row({ seconds: 300, minute: 1270 }),
		row({ seconds: 200, minute: 1280 }),
		row({
			seconds: 600,
			day: '2026-11-05',
			minute: 600,
			item: 'm1',
			kind: 'pelicula',
			seriesTitle: null,
			title: 'Peli',
			season: null,
			number: null
		}),
		row({ seconds: 60, day: '2026-10-20', item: 'e9' })
	]);
	const stats = await watchStats(k, 'ana', TODAY, 4, null);
	expect(stats.days.length).toBe(14);
	expect(stats.days.at(-1)).toEqual({ day: TODAY, seconds: 500 });
	expect(stats.days.at(-2)).toEqual({ day: '2026-11-05', seconds: 600 });
	expect(stats.days[0].day).toBe('2026-10-24');
	// Older than the two weeks: in the weeks, not here.
	expect(stats.latest.map((w) => [w.item, w.seconds, w.lastDay])).toEqual([
		['e1', 500, TODAY],
		['m1', 600, '2026-11-05']
	]);
	expect(stats.latest[0]).toMatchObject({ userId: 'peque', seriesTitle: 'Bluey', season: 1 });
});

test('the latest of all of them: another adult’s is not there', async () => {
	await saveWatched(k, 'luis', [row({ item: 'e5', seriesTitle: 'De Luis' })]);
	await saveWatched(k, 'ana', [row({ minute: 600 })]);
	const stats = await watchStats(k, 'ana', TODAY, 4, null);
	expect(stats.latest.map((w) => w.userId)).toEqual(['ana']);
});

test('of one kind: everything of that kind only, and the kinds there are to choose', async () => {
	await saveWatched(k, 'ana', [
		row({ seconds: 300 }),
		row({
			seconds: 900,
			item: 's4',
			kind: 'web',
			seriesTitle: null,
			title: 'NBA',
			season: null,
			number: null
		})
	]);
	await saveWatched(k, 'peque', [
		row({ seconds: 100, item: 'cclan', kind: 'canal', title: 'Clan', seriesTitle: null })
	]);
	const all = await watchStats(k, 'ana', TODAY, 4, null);
	expect(all.kind).toBeNull();
	expect(all.kinds).toEqual(['serie', 'canal', 'web']);
	const webs = await watchStats(k, 'ana', TODAY, 4, null, { kind: 'web' });
	expect(webs.people.map((p) => [p.id, p.seconds])).toEqual([
		['ana', 900],
		['peque', 0]
	]);
	expect(webs.titles).toEqual([{ label: 'NBA', kind: 'web', seconds: 900 }]);
	expect(webs.days.at(-1)?.seconds).toBe(900);
	expect(webs.latest.map((w) => w.title)).toEqual(['NBA']);
	expect(webs.hours[21].seconds).toBe(900);
	// The kinds there are, of the person chosen.
	expect((await watchStats(k, 'ana', TODAY, 4, 'peque')).kinds).toEqual(['canal']);
});

test('weeks go from Monday, this one the last', () => {
	expect(lastDays(TODAY, 3)).toEqual(['2026-11-04', '2026-11-05', TODAY]);
	expect(mondayOf('2026-11-08')).toBe('2026-11-02');
	expect(mondayOf('2026-11-02')).toBe('2026-11-02');
	expect(lastMondays(TODAY, 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
});

test('what the house sends is checked as a whole', () => {
	expect(parseWatchRows([row()])).toEqual([row()]);
	const played = row({
		item: 'j7',
		kind: 'juego',
		seriesTitle: null,
		title: 'Super Mario World',
		season: null,
		number: null
	});
	expect(parseWatchRows([played])).toEqual([played]);
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

const episode = { item: 'p7', kind: 'podcast' as const, seriesTitle: 'La Ventana', title: 'Lunes' };
// In the server's time zone, as the slots are: 21:12 is in the 21:10 slot.
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 6, h, m, s);

test('listened to: what the position moved forward, added to its slot', async () => {
	await addListened(k, 'ana', episode, 100, 'tab1', at(21, 12, 0));
	await addListened(k, 'ana', episode, 115, 'tab1', at(21, 12, 15));
	await addListened(k, 'ana', episode, 130, 'tab1', at(21, 12, 30));
	// Jumping ahead counts only the time that went by; going back, nothing.
	await addListened(k, 'ana', episode, 900, 'tab1', at(21, 12, 45));
	await addListened(k, 'ana', episode, 50, 'tab1', at(21, 13, 0));
	const rows = await db.select().from(watchLog);
	expect(rows.length).toBe(1);
	expect(rows[0]).toMatchObject({
		day: TODAY,
		minute: 1270,
		item: 'p7',
		kind: 'podcast',
		seriesTitle: 'La Ventana',
		title: 'Lunes'
	});
	expect(rows[0].seconds).toBe(46);
});

test('each player on its own: two at once do not mix their positions', async () => {
	await addListened(k, 'ana', episode, 100, 'movil', at(22, 0, 0));
	await addListened(k, 'ana', episode, 2000, 'casa', at(22, 0, 5));
	await addListened(k, 'ana', episode, 115, 'movil', at(22, 0, 15));
	await addListened(k, 'ana', episode, 2010, 'casa', at(22, 0, 15));
	const [row] = await db.select().from(watchLog);
	expect(row.seconds).toBe(25);
});

test('listened to: not counted for an adult whose house says not to keep it; a child’s always', async () => {
	await setKeepsHistory(k, 'luis', false);
	await setKeepsHistory(k, 'peque', false);
	for (const userId of ['luis', 'peque']) {
		await addListened(k, userId, episode, 100, 'tab', at(18, 0, 0));
		await addListened(k, userId, episode, 110, 'tab', at(18, 0, 10));
	}
	expect((await db.select().from(watchLog)).map((r) => r.userId)).toEqual(['peque']);

	await setKeepsHistory(k, 'luis', true);
	await addListened(k, 'luis', episode, 120, 'tab', at(18, 0, 20));
	expect((await db.select().from(watchLog)).map((r) => r.userId).sort()).toEqual(['luis', 'peque']);
});

test('the house’s whole rows and what is listened to here live together', async () => {
	await saveWatched(k, 'ana', [row()]);
	await addListened(k, 'ana', episode, 10, 'tab', at(21, 11, 0));
	await addListened(k, 'ana', episode, 20, 'tab', at(21, 11, 10));
	await saveWatched(k, 'ana', [row({ seconds: 400 })]);
	const watched = await watchStats(k, 'ana', TODAY, 4, null);
	expect(watched.titles.map((t) => [t.label, t.kind, t.seconds])).toEqual([
		['Bluey', 'serie', 400]
	]);
	const heard = await watchStats(k, 'ana', TODAY, 4, null, { area: 'escuchar' });
	expect(heard.titles.map((t) => [t.label, t.kind, t.seconds])).toEqual([
		['La Ventana', 'podcast', 10]
	]);
});

test('three tabs, never added up: each its own, and the time of each to choose', async () => {
	const other = { seriesTitle: null, season: null, number: null };
	await saveWatched(k, 'ana', [
		row({ seconds: 600 }),
		row({
			item: 't1',
			kind: 'cancion',
			seriesTitle: 'Serrat',
			title: 'Mediterráneo',
			season: null,
			number: null,
			seconds: 1200
		}),
		row({ item: 'rbbc', kind: 'radio', title: 'BBC', ...other, seconds: 300 }),
		row({ item: 'j1', kind: 'juego', title: 'Super Mario World', ...other, seconds: 900 })
	]);
	const watched = await watchStats(k, 'ana', TODAY, 4, null);
	expect(watched.area).toBe('ver');
	expect(watched.areas).toEqual([
		{ area: 'ver', seconds: 600 },
		{ area: 'escuchar', seconds: 1500 },
		{ area: 'jugar', seconds: 900 }
	]);
	expect(watched.people.find((p) => p.id === 'ana')?.seconds).toBe(600);
	expect(watched.kinds).toEqual(['serie']);

	const heard = await watchStats(k, 'ana', TODAY, 4, null, { area: 'escuchar' });
	expect(heard.people.find((p) => p.id === 'ana')?.seconds).toBe(1500);
	expect(heard.kinds).toEqual(['cancion', 'radio']);
	expect(heard.titles.map((t) => t.label)).toEqual(['Serrat', 'BBC']);
	expect(heard.days.at(-1)?.seconds).toBe(1500);
	expect(heard.latest.map((w) => w.item).sort()).toEqual(['rbbc', 't1']);

	// A kind of another tab is not one of this one: the whole tab.
	const played = await watchStats(k, 'ana', TODAY, 4, null, { area: 'jugar', kind: 'radio' });
	expect(played.kind).toBeNull();
	expect(played.titles.map((t) => t.label)).toEqual(['Super Mario World']);
});
