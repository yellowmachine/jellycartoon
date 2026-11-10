import { and, asc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type * as schema from '#lib/server/db/schema.ts';
import {
	episode,
	episodeTitle,
	game,
	gameSession,
	movie,
	movieTitle,
	series,
	tvShortcut,
	user,
	userSettings,
	watchTime
} from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/kids-role.ts';
import { SLOT_MINUTES } from '#lib/kid-time.ts';
import { CHANNELS } from 'comun/channels.ts';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * What goes to Seilide of what is watched here (#421), on the database and with the sending given,
 * to test it (watch-log.ts sends). One way: the whole seconds of each slot, so that sending again
 * changes nothing; what could not be sent stays to send. Starts counting on `since`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Of a request. Seilide may not know the person: nothing to keep, nor to send again. */
export type SendWatch = (
	userId: string,
	body: { action: 'save'; rows: WatchRow[] } | { action: 'forget' }
) => Promise<{ known?: boolean }>;

export interface WatchRow {
	day: string;
	minute: number;
	item: string;
	kind: 'serie' | 'pelicula' | 'canal' | 'web' | 'juego';
	seriesTitle: string | null;
	title: string;
	season: number | null;
	number: number | null;
	seconds: number;
}

/** A game's name as the games screen shows it, by `system/file`; the file's, if it is not there. */
export type GameNames = () => Promise<Map<string, string>>;

/** As many as Seilide takes at once (MAX_ROWS there). */
const BATCH = 500;
/** Less than this is a difference of how `real` is written, or nothing to tell. */
const MIN_NEW_SECONDS = 0.5;

const channelName = (id: string) => CHANNELS.find((c) => c.id === id)?.name ?? id;

/** Whether a person's goes to Seilide: kids always, adults who keep what they watch. */
const keeps = or(eq(user.role, KIDS_ROLE), sql`coalesce(${userSettings.keepHistory}, true)`);

/** The slots with seconds Seilide does not know yet, of who keeps what they watch; kids always. */
function pending(db: Db, since: string) {
	return db
		.select({
			id: watchTime.id,
			userId: watchTime.userId,
			day: watchTime.day,
			minute: watchTime.minute,
			episodeId: watchTime.episodeId,
			movieId: watchTime.movieId,
			channelId: watchTime.channelId,
			shortcutId: watchTime.shortcutId,
			seconds: watchTime.seconds,
			seriesTitle: series.title,
			title: sql<string | null>`coalesce(${movieTitle}, ${episodeTitle}, ${tvShortcut.name})`,
			season: episode.season,
			number: episode.number
		})
		.from(watchTime)
		.innerJoin(user, eq(user.id, watchTime.userId))
		.leftJoin(userSettings, eq(userSettings.userId, watchTime.userId))
		.leftJoin(episode, eq(episode.id, watchTime.episodeId))
		.leftJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(movie, eq(movie.id, watchTime.movieId))
		.leftJoin(tvShortcut, eq(tvShortcut.id, watchTime.shortcutId))
		.where(
			and(
				gte(watchTime.day, since),
				isNotNull(watchTime.minute),
				sql`${watchTime.seconds} > ${watchTime.sentSeconds} + ${MIN_NEW_SECONDS}`,
				keeps
			)
		)
		.orderBy(asc(watchTime.userId), asc(watchTime.id))
		.limit(BATCH);
}

type Pending = Awaited<ReturnType<typeof pending>>[number];

function rowOf(r: Pending): WatchRow {
	const common = { day: r.day, minute: r.minute!, seconds: r.seconds };
	const none = { seriesTitle: null, season: null, number: null };
	if (r.channelId)
		return {
			...common,
			...none,
			item: `c${r.channelId}`,
			kind: 'canal',
			title: channelName(r.channelId)
		};
	if (r.shortcutId)
		return { ...common, ...none, item: `s${r.shortcutId}`, kind: 'web', title: r.title! };
	if (r.movieId)
		return { ...common, ...none, item: `m${r.movieId}`, kind: 'pelicula', title: r.title! };
	return {
		...common,
		item: `e${r.episodeId}`,
		kind: 'serie',
		seriesTitle: r.seriesTitle,
		title: r.title!,
		season: r.season,
		number: r.number
	};
}

/** What was turned off, deleted there. Before sending, for what comes after to stay. */
async function forgetThoseWhoAsked(db: Db, send: SendWatch) {
	const people = await db
		.select({ userId: userSettings.userId })
		.from(userSettings)
		.where(eq(userSettings.forgetSentWatch, true));
	for (const { userId } of people) {
		await send(userId, { action: 'forget' });
		await db
			.update(userSettings)
			.set({ forgetSentWatch: false })
			.where(eq(userSettings.userId, userId));
	}
}

/**
 * All that is left to send. A failure stops here, and all of it is sent next time. What a slot had
 * when read is what counts as sent: what it grew by meanwhile goes next time. Someone Seilide does
 * not know counts as sent too, not to ask for them again and again. Games after what is watched,
 * in requests of their own: a Seilide that does not take them yet holds back only them.
 */
export async function sendWatchLog(db: Db, since: string, send: SendWatch, games?: GameNames) {
	await forgetThoseWhoAsked(db, send);
	for (;;) {
		const rows = await pending(db, since);
		const byPerson = Map.groupBy(rows, (r) => r.userId);
		for (const [userId, theirs] of byPerson) {
			await send(userId, { action: 'save', rows: theirs.map(rowOf) });
			await db.transaction(async (tx) => {
				for (const r of theirs)
					await tx.update(watchTime).set({ sentSeconds: r.seconds }).where(eq(watchTime.id, r.id));
			});
		}
		if (rows.length < BATCH) break;
	}
	if (games) await sendGames(db, since, send, games);
}

/** The day and slot a time is in, in the server's time zone (TZ), as watch-time.ts does. */
function slotOf(date: Date) {
	const minute = date.getHours() * 60 + date.getMinutes();
	const day = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
	return { day, minute: minute - (minute % SLOT_MINUTES) };
}

/**
 * The games played (#176) as slots, like what is watched: each session, all of it in the slot it
 * started in; those of the same game in the same slot, one. As the sessions have no slots, the
 * whole of each slot is summed again from the sessions in it, so that sending again is the same.
 */
async function sendGames(db: Db, since: string, send: SendWatch, games: GameNames) {
	let names: Map<string, string> | undefined;
	for (;;) {
		const fresh = await db
			.select({
				userId: gameSession.userId,
				gameId: gameSession.gameId,
				startedAt: gameSession.startedAt
			})
			.from(gameSession)
			.innerJoin(user, eq(user.id, gameSession.userId))
			.leftJoin(userSettings, eq(userSettings.userId, gameSession.userId))
			.where(
				and(
					gte(gameSession.startedAt, sql`${since}::date`),
					sql`${gameSession.seconds} > ${gameSession.sentSeconds}`,
					keeps
				)
			)
			.orderBy(asc(gameSession.id))
			.limit(BATCH);
		if (!fresh.length) return;
		const key = (r: { userId: string; gameId: number; startedAt: Date }) => {
			const { day, minute } = slotOf(r.startedAt);
			return `${r.userId} ${day} ${minute} ${r.gameId}`;
		};
		const wanted = new Set(fresh.map(key));
		// Those in the same slots: from a slot before the first, as one may have started earlier in it.
		const first = Math.min(...fresh.map((r) => r.startedAt.getTime()));
		const around = await db
			.select({
				id: gameSession.id,
				userId: gameSession.userId,
				gameId: gameSession.gameId,
				startedAt: gameSession.startedAt,
				seconds: gameSession.seconds,
				system: game.system,
				file: game.file
			})
			.from(gameSession)
			.innerJoin(game, eq(game.id, gameSession.gameId))
			.where(
				and(
					inArray(gameSession.userId, [...new Set(fresh.map((r) => r.userId))]),
					gte(gameSession.startedAt, new Date(first - SLOT_MINUTES * 60_000))
				)
			);
		const inSlots = around.filter((r) => wanted.has(key(r)));
		names ??= await games();
		const byPerson = Map.groupBy(inSlots, (r) => r.userId);
		for (const [userId, theirs] of byPerson) {
			const slots = Map.groupBy(theirs, key);
			const rows: WatchRow[] = [...slots.values()].map((same) => {
				const { system, file, gameId, startedAt } = same[0];
				return {
					...slotOf(startedAt),
					item: `j${gameId}`,
					kind: 'juego',
					seriesTitle: null,
					title: names!.get(`${system}/${file}`) ?? file,
					season: null,
					number: null,
					seconds: same.reduce((n, r) => n + r.seconds, 0)
				};
			});
			await send(userId, { action: 'save', rows });
			await db.transaction(async (tx) => {
				for (const r of theirs)
					await tx
						.update(gameSession)
						.set({ sentSeconds: r.seconds })
						.where(eq(gameSession.id, r.id));
			});
		}
		if (fresh.length < BATCH) return;
	}
}
