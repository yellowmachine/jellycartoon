import { and, asc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import type * as schema from '#lib/server/db/schema.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieTitle,
	series,
	tvShortcut,
	user,
	userSettings,
	watchTime
} from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/kids-role.ts';
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
	kind: 'serie' | 'pelicula' | 'canal' | 'web';
	seriesTitle: string | null;
	title: string;
	season: number | null;
	number: number | null;
	seconds: number;
}

/** As many as Seilide takes at once (MAX_ROWS there). */
const BATCH = 500;
/** Less than this is a difference of how `real` is written, or nothing to tell. */
const MIN_NEW_SECONDS = 0.5;

const channelName = (id: string) => CHANNELS.find((c) => c.id === id)?.name ?? id;

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
				or(eq(user.role, KIDS_ROLE), sql`coalesce(${userSettings.keepHistory}, true)`)
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
 * not know counts as sent too, not to ask for them again and again.
 */
export async function sendWatchLog(db: Db, since: string, send: SendWatch) {
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
		if (rows.length < BATCH) return;
	}
}
