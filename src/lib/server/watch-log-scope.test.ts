import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './db/schema.ts';
import { episode, game, gameSession, series, user, userSettings, watchTime } from './db/schema.ts';
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
	await db.delete(gameSession);
	await db.delete(game);
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

/** Played at home: Super Mario World, and an arcade one with no name in the screen. */
const games = async () => new Map([['snes/smw.sfc', 'Super Mario World']]);
const session = (
	userId: string,
	at: Date,
	seconds: number,
	over: Partial<typeof gameSession.$inferInsert> = {}
) => ({ userId, gameId: 1, startedAt: at, endedAt: at, seconds, ...over });
// In the server's time zone, as the slots are.
const at = (h: number, m: number, day = 6) => new Date(2026, 10, day, h, m);

async function withGames() {
	await db.insert(game).values([
		{ id: 1, system: 'snes', file: 'smw.sfc' },
		{ id: 2, system: 'arcade', file: 'pacman.zip' }
	] as never);
}

test('games go after what is watched, each slot once with the sessions in it summed', async () => {
	await withGames();
	await db.insert(watchTime).values(slot('ana'));
	await db
		.insert(gameSession)
		.values([
			session('ana', at(21, 12), 120),
			session('ana', at(21, 18), 60),
			session('ana', at(21, 25), 300),
			session('ana', at(22, 0), 30, { gameId: 2 })
		]);
	await sendWatchLog(db, SINCE, send, games);
	expect(sent.map((s) => s.rows!.map((r) => r.kind))).toEqual([
		['serie'],
		['juego', 'juego', 'juego']
	]);
	const played = sent[1].rows!.map((r) => [r.day, r.minute, r.item, r.title, r.seconds]);
	expect(played).toEqual([
		[SINCE, 1270, 'j1', 'Super Mario World', 180],
		[SINCE, 1280, 'j1', 'Super Mario World', 300],
		[SINCE, 1320, 'j2', 'pacman.zip', 30]
	]);
	expect(sent[1].rows![0]).toMatchObject({ seriesTitle: null, season: null, number: null });

	sent = [];
	await sendWatchLog(db, SINCE, send, games);
	expect(sent).toEqual([]);
});

test('a session that grows sends its whole slot again, with the others in it', async () => {
	await withGames();
	await db
		.insert(gameSession)
		.values([
			session('ana', at(21, 12), 120, { id: 1 }),
			session('ana', at(21, 18), 60, { id: 2 })
		]);
	await sendWatchLog(db, SINCE, send, games);
	sent = [];
	await db.update(gameSession).set({ seconds: 90 }).where(eq(gameSession.id, 2));
	await sendWatchLog(db, SINCE, send, games);
	expect(saved().map((r) => [r.minute, r.seconds])).toEqual([[1270, 210]]);
});

test('games: not of who does not keep history, nor from before; a child’s always', async () => {
	await withGames();
	await db.insert(userSettings).values({ userId: 'luis', keepHistory: false });
	await db
		.insert(gameSession)
		.values([
			session('luis', at(21, 0), 100),
			session('ana', at(21, 0, 5), 100),
			session('peque', at(18, 0), 100)
		]);
	await sendWatchLog(db, SINCE, send, games);
	expect(sent.map((s) => s.userId)).toEqual(['peque']);
});

test('without the games’ names, no games are sent', async () => {
	await withGames();
	await db.insert(gameSession).values(session('ana', at(21, 12), 120));
	await sendWatchLog(db, SINCE, send);
	expect(sent).toEqual([]);
});

test('if Seilide refuses the games, what is watched is already sent and kept as sent', async () => {
	await withGames();
	await db.insert(watchTime).values(slot('ana'));
	await db.insert(gameSession).values(session('ana', at(21, 12), 120));
	const refusing: SendWatch = async (userId, body) => {
		if (body.action === 'save' && body.rows.some((r) => r.kind === 'juego')) throw new Error('400');
		return send(userId, body);
	};
	await expect(sendWatchLog(db, SINCE, refusing, games)).rejects.toThrow('400');
	const [row] = await db.select().from(watchTime);
	expect(row.sentSeconds).toBe(300);
	const [s] = await db.select().from(gameSession);
	expect(s.sentSeconds).toBe(0);
});
