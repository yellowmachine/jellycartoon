import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './db/schema.ts';
import { episode, series, user, userSettings, watchTime } from './db/schema.ts';
import { sendWatchLog, type SendWatch, type WatchRow } from './watch-log-scope.ts';

/** On a real Postgres (PGlite), with the migrations as they are and a Seilide that keeps what comes. */
const db = drizzle(new PGlite(), { schema });
const SINCE = '2026-11-06';

type Sent = { userId: string; action: string; rows?: WatchRow[] };
let sent: Sent[];
let answer: () => Promise<{ known?: boolean }>;
const send: SendWatch = async (userId, body) => {
	const known = await answer();
	sent.push({ userId, ...body });
	return known;
};
const saved = () => sent.flatMap((s) => s.rows ?? []);

const person = (id: string, role: string | null = null) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	role,
	createdAt: new Date(),
	updatedAt: new Date()
});

const slot = (userId: string, over: Partial<typeof watchTime.$inferInsert> = {}) => ({
	userId,
	day: SINCE,
	minute: 1270,
	episodeId: 1,
	seconds: 300,
	...over
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

beforeEach(async () => {
	sent = [];
	answer = async () => ({ known: true });
	await db.delete(watchTime);
	await db.delete(userSettings);
	await db.delete(user);
	await db.delete(episode);
	await db.delete(series);
	await db.insert(user).values([person('ana'), person('luis'), person('peque', 'infantil')]);
	await db.insert(series).values({ id: 1, title: 'Bluey', folder: 'bluey' } as never);
	await db.insert(episode).values({
		id: 1,
		seriesId: 1,
		season: 2,
		number: 3,
		title: 'Capítulo',
		sourcePath: 'a.mkv',
		sourceSize: 1,
		sourceMtime: new Date()
	} as never);
});

test('a slot goes once with its titles and its whole seconds, and again only if it grows', async () => {
	await db.insert(watchTime).values(slot('ana'));
	await sendWatchLog(db, SINCE, send);
	expect(saved()).toEqual([
		{
			day: SINCE,
			minute: 1270,
			item: 'e1',
			kind: 'serie',
			seriesTitle: 'Bluey',
			title: 'Capítulo',
			season: 2,
			number: 3,
			seconds: 300
		}
	]);
	sent = [];
	await sendWatchLog(db, SINCE, send);
	expect(sent).toEqual([]);

	await db.update(watchTime).set({ seconds: 420 });
	await sendWatchLog(db, SINCE, send);
	expect(saved().map((r) => r.seconds)).toEqual([420]);
});

test('without an answer nothing counts as sent, and it all goes when it answers', async () => {
	await db.insert(watchTime).values(slot('ana'));
	answer = async () => {
		throw new Error('Sin internet');
	};
	await expect(sendWatchLog(db, SINCE, send)).rejects.toThrow('Sin internet');
	answer = async () => ({ known: true });
	await sendWatchLog(db, SINCE, send);
	expect(saved().length).toBe(1);
});

test('what Seilide does not know of someone is not asked for again', async () => {
	await db.insert(watchTime).values(slot('ana'));
	answer = async () => ({ known: false });
	await sendWatchLog(db, SINCE, send);
	sent = [];
	await sendWatchLog(db, SINCE, send);
	expect(sent).toEqual([]);
});

test('nothing from before it started', async () => {
	await db.insert(watchTime).values(slot('ana', { day: '2026-11-05' }));
	await sendWatchLog(db, SINCE, send);
	expect(sent).toEqual([]);
});

test('channels and shortcuts go with their name; each person, in their own request', async () => {
	await db
		.insert(watchTime)
		.values([slot('ana', { episodeId: null, channelId: 'la1' }), slot('luis', { minute: 1280 })]);
	await sendWatchLog(db, SINCE, send);
	expect(sent.map((s) => s.userId).sort()).toEqual(['ana', 'luis']);
	const channel = saved().find((r) => r.kind === 'canal');
	expect(channel).toMatchObject({ item: 'cla1', seriesTitle: null, season: null });
	expect(channel?.title).toBeTruthy();
});

test('more than a batch goes in several, all of it', async () => {
	await db
		.insert(watchTime)
		.values(
			Array.from({ length: 1201 }, (_, i) =>
				slot('ana', { day: `2026-11-${String(6 + (i % 20)).padStart(2, '0')}`, minute: i % 1440 })
			)
		);
	await sendWatchLog(db, SINCE, send);
	expect(sent.length).toBe(3);
	expect(sent.every((s) => (s.rows?.length ?? 0) <= 500)).toBe(true);
	expect(saved().length).toBe(1201);
});

test('who keeps nothing sends nothing; a child, whatever is in its settings', async () => {
	await db.insert(userSettings).values([
		{ userId: 'ana', keepHistory: false },
		{ userId: 'peque', keepHistory: false }
	]);
	await db.insert(watchTime).values([slot('ana'), slot('peque')]);
	await sendWatchLog(db, SINCE, send);
	expect(sent.map((s) => s.userId)).toEqual(['peque']);
});

test('forgetting goes before sending, until it is answered, and only once', async () => {
	await db.insert(userSettings).values({ userId: 'ana', forgetSentWatch: true });
	await db.insert(watchTime).values(slot('ana'));
	answer = async () => {
		throw new Error('Sin internet');
	};
	await expect(sendWatchLog(db, SINCE, send)).rejects.toThrow();
	const [still] = await db.select().from(userSettings).where(eq(userSettings.userId, 'ana'));
	expect(still.forgetSentWatch).toBe(true);

	answer = async () => ({ known: true });
	await sendWatchLog(db, SINCE, send);
	expect(sent.map((s) => s.action)).toEqual(['forget', 'save']);

	sent = [];
	await sendWatchLog(db, SINCE, send);
	expect(sent).toEqual([]);
});
