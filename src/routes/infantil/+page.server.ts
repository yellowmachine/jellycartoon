import { and, asc, desc, eq, gt, gte, max, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieProgress,
	movieTitle,
	series,
	user,
	watchProgress,
	watchTime
} from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { today } from '#lib/server/playlist.ts';
import { continueWatching } from '#lib/server/watching.ts';

/** Days in the chart, today included. */
const DAYS = 7;

/** `YYYY-MM-DD`, `n` days before `day`. */
function daysBefore(day: string, n: number) {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - n);
	return date.toISOString().slice(0, 10);
}

/** What children watch (#17), for the adults: a child's account never gets here (see kids.ts). */
export const load: PageServerLoad = async () => {
	const kids = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.role, KIDS_ROLE))
		.orderBy(asc(user.name));
	const day = today();
	const from = daysBefore(day, DAYS - 1);
	return {
		today: day,
		days: Array.from({ length: DAYS }, (_, i) => daysBefore(day, DAYS - 1 - i)),
		kids: await Promise.all(kids.map(async (kid) => ({ ...kid, ...(await stats(kid.id, from)) })))
	};
};

async function stats(userId: string, from: string) {
	const recent = and(eq(watchTime.userId, userId), gte(watchTime.day, from));
	const [perDay, watched, halfway, halfwayFilms, finished, finishedFilms] = await Promise.all([
		db
			.select({ day: watchTime.day, seconds: sql<number>`sum(${watchTime.seconds})::real` })
			.from(watchTime)
			.where(recent)
			.groupBy(watchTime.day),
		// What was watched these days, the latest first.
		db
			.select({
				episodeId: watchTime.episodeId,
				movieId: watchTime.movieId,
				title: sql<string>`coalesce(${movieTitle}, ${episodeTitle})`,
				seriesId: series.id,
				seriesTitle: series.title,
				season: episode.season,
				number: episode.number,
				seconds: sql<number>`sum(${watchTime.seconds})::real`,
				lastDay: max(watchTime.day)
			})
			.from(watchTime)
			.leftJoin(episode, eq(episode.id, watchTime.episodeId))
			.leftJoin(series, eq(series.id, episode.seriesId))
			.leftJoin(movie, eq(movie.id, watchTime.movieId))
			.where(recent)
			.groupBy(watchTime.episodeId, watchTime.movieId, episode.id, series.id, movie.id)
			.orderBy(desc(max(watchTime.day)), desc(sql`sum(${watchTime.seconds})`))
			.limit(15),
		continueWatching(userId, 6),
		db
			.select({
				id: movie.id,
				title: movieTitle,
				positionSec: movieProgress.positionSec,
				durationSec: movie.durationSec
			})
			.from(movieProgress)
			.innerJoin(movie, eq(movie.id, movieProgress.movieId))
			.where(
				and(
					eq(movieProgress.userId, userId),
					eq(movieProgress.completed, false),
					gt(movieProgress.positionSec, 0)
				)
			)
			.orderBy(desc(movieProgress.updatedAt))
			.limit(6),
		db
			.select({
				id: episode.id,
				title: episodeTitle,
				seriesId: series.id,
				seriesTitle: series.title,
				season: episode.season,
				number: episode.number,
				at: watchProgress.updatedAt
			})
			.from(watchProgress)
			.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true)))
			.orderBy(desc(watchProgress.updatedAt))
			.limit(10),
		db
			.select({ id: movie.id, title: movieTitle, at: movieProgress.updatedAt })
			.from(movieProgress)
			.innerJoin(movie, eq(movie.id, movieProgress.movieId))
			.where(and(eq(movieProgress.userId, userId), eq(movieProgress.completed, true)))
			.orderBy(desc(movieProgress.updatedAt))
			.limit(10)
	]);

	const [[lastEpisode], [lastFilm]] = await Promise.all([
		db
			.select({ at: max(watchProgress.updatedAt) })
			.from(watchProgress)
			.where(eq(watchProgress.userId, userId)),
		db
			.select({ at: max(movieProgress.updatedAt) })
			.from(movieProgress)
			.where(eq(movieProgress.userId, userId))
	]);
	const lastActivity =
		[lastEpisode?.at, lastFilm?.at]
			.filter((at): at is Date => Boolean(at))
			.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

	return {
		/** Seconds watched each day, by `YYYY-MM-DD`. */
		perDay: Object.fromEntries(perDay.map((d) => [d.day, d.seconds])),
		watched,
		halfway: [
			...halfway.map((e) => ({
				href: `/series/${e.seriesId}`,
				title: e.title,
				detail: `${e.seriesTitle} · T${e.season} E${e.number}`,
				positionSec: e.positionSec,
				durationSec: e.durationSec
			})),
			...halfwayFilms.map((f) => ({
				href: `/cine/${f.id}`,
				title: f.title,
				detail: 'Película',
				positionSec: f.positionSec,
				durationSec: f.durationSec
			}))
		],
		finished: [
			...finished.map((e) => ({
				href: `/series/${e.seriesId}`,
				title: e.title,
				detail: `${e.seriesTitle} · T${e.season} E${e.number}`,
				at: e.at
			})),
			...finishedFilms.map((f) => ({
				href: `/cine/${f.id}`,
				title: f.title,
				detail: 'Película',
				at: f.at
			}))
		]
			.sort((a, b) => b.at.getTime() - a.at.getTime())
			.slice(0, 10),
		lastActivity
	};
}
