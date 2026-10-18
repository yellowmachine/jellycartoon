import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieInfo,
	movieProgress,
	movieTitle,
	series,
	watchProgress
} from '#lib/server/db/schema.ts';
import { allowedEpisodes, allowedMovies, allowedSeries } from '#lib/server/kids.ts';
import { fold } from '#lib/music.ts';

/**
 * The series and films there are, for voice commands (#33): to find one by its name, as it was
 * heard, and the episodes of a series, so that «pon Friends, temporada 3, capítulo 7» has an id
 * for `play_video`. Only what can be played: ready and not missing.
 */

/** Results of each kind, at most: the model picks, or asks. */
const MAX_FOUND = 10;
/** Shorter words («de», «la») are no clue when nothing matches them all. */
const MIN_CLUE = 3;

/** As the model is told it: below a few seconds, not started (the players start over there too). */
function seen(p: {
	completed: boolean | null;
	positionSec: number | null;
	durationSec: number | null;
}) {
	if (p.completed) return 'visto';
	if (!p.positionSec || p.positionSec <= 5) return 'sin ver';
	const of = p.durationSec ? ` de ${Math.round(p.durationSec / 60)}` : '';
	return `a medias, minuto ${Math.floor(p.positionSec / 60)}${of}`;
}

/**
 * Series and films whose title (or a film's original title) has every word said; failing that, any
 * long enough one, as «parecidos»: what is heard is not always what was said.
 */
export async function searchVideo(userId: string, query: string) {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return 'Falta qué buscar.';

	const [seriesRows, films] = await Promise.all([
		db
			.select({
				id: series.id,
				title: series.title,
				episodes: sql<number>`count(${episode.id})::int`,
				seasons: sql<number>`count(distinct ${episode.season})::int`
			})
			.from(series)
			.innerJoin(episode, eq(episode.seriesId, series.id))
			.where(and(eq(episode.status, 'ready'), eq(episode.missing, false), allowedSeries()))
			.groupBy(series.id),
		db
			.select({
				id: movie.id,
				title: movieTitle,
				year: movie.year,
				infoTitle: movieInfo.title,
				originalTitle: movieInfo.originalTitle,
				durationSec: movie.durationSec,
				positionSec: movieProgress.positionSec,
				completed: movieProgress.completed
			})
			.from(movie)
			.leftJoin(movieInfo, eq(movieInfo.movieId, movie.id))
			.leftJoin(
				movieProgress,
				and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, userId))
			)
			.where(and(eq(movie.status, 'ready'), eq(movie.missing, false), allowedMovies()))
	]);
	const filmText = (f: (typeof films)[number]) =>
		[f.title, f.infoTitle, f.originalTitle].filter(Boolean).join(' ');
	const aka = (f: (typeof films)[number]) =>
		[...new Set([f.infoTitle, f.originalTitle])].filter(
			(t): t is string => Boolean(t) && t !== f.title
		);

	const find = (hit: (text: string) => boolean) => ({
		series: seriesRows
			.filter((s) => hit(s.title))
			.slice(0, MAX_FOUND)
			.map((s) => ({
				what: `«${s.title}» [serie ${s.id}]`,
				seasons: s.seasons,
				episodes: s.episodes
			})),
		films: films
			.filter((f) => hit(filmText(f)))
			.slice(0, MAX_FOUND)
			.map((f) => ({
				what: `«${f.title}»${f.year ? ` (${f.year})` : ''} [película ${f.id}]`,
				// The title in the app may be the file's: these are how it is known.
				...(aka(f).length && { alsoKnownAs: aka(f) }),
				seen: seen(f)
			})),
		total: 0
	});
	const all = find((text) => words.every((w) => fold(text).includes(w)));
	all.total = all.series.length + all.films.length;
	if (all.total) return JSON.stringify({ series: all.series, films: all.films });

	const clues = words.filter((w) => w.length >= MIN_CLUE);
	const some = find((text) => clues.some((w) => fold(text).includes(w)));
	some.total = some.series.length + some.films.length;
	return some.total
		? JSON.stringify({ similar: true, series: some.series, films: some.films })
		: `Nada con «${query}». Prueba con otras palabras o con el título original.`;
}

/**
 * A series' seasons, with how many episodes and how many the user finished; with `season`, its
 * episodes, with their ids and where the user is in each.
 */
export async function seriesEpisodes(userId: string, seriesId: number, season?: number) {
	const [found] = await db
		.select({ title: series.title })
		.from(series)
		.where(and(eq(series.id, seriesId), allowedSeries()));
	if (!found) return `No hay serie con id ${seriesId}. Búscala con search_video.`;

	const rows = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			durationSec: episode.durationSec,
			positionSec: watchProgress.positionSec,
			completed: watchProgress.completed
		})
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(
			and(
				eq(episode.seriesId, seriesId),
				eq(episode.status, 'ready'),
				eq(episode.missing, false),
				allowedEpisodes()
			)
		)
		.orderBy(asc(episode.season), asc(episode.number));

	if (season === undefined) {
		const seasons = new Map<number, { season: number; episodes: number; finished: number }>();
		for (const r of rows) {
			const s = seasons.get(r.season) ?? { season: r.season, episodes: 0, finished: 0 };
			s.episodes++;
			if (r.completed) s.finished++;
			seasons.set(r.season, s);
		}
		return JSON.stringify({ series: found.title, seasons: [...seasons.values()] });
	}

	const episodes = rows.filter((r) => r.season === season);
	if (!episodes.length) return `«${found.title}» no tiene temporada ${season}.`;
	return JSON.stringify({
		series: found.title,
		season,
		episodes: episodes.map((e) => ({
			what: `T${e.season} E${e.number} «${e.title}» [episodio ${e.id}]`,
			seen: seen(e)
		}))
	});
}
