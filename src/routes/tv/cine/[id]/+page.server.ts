import { error } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieInfo, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { play } from '#lib/server/cinema/film-actions.ts';
import { savedMovieInfo } from '#lib/server/cinema/info.ts';
import { filmAutoSubtitles } from '#lib/server/auto-subtitles.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import { allowedMovies } from '#lib/server/kids.ts';
import { cinemaRoot } from '#lib/server/library/paths.ts';

/** A film's card on the TV: what it is, and to watch it, whole or from a scene. */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!mpvEnabled || !cinemaRoot) error(404, 'No hay películas que ver en el salón');
	const id = Number(params.id);
	const userId = locals.user!.id;
	const [film] = await db
		.select({
			id: movie.id,
			title: movieTitle,
			year: movie.year,
			durationSec: movie.durationSec,
			audioTracks: movie.audioTracks,
			subtitles: movie.subtitles,
			chapters: movie.chapters,
			positionSec: movieProgress.positionSec,
			completed: movieProgress.completed
		})
		.from(movie)
		.leftJoin(
			movieProgress,
			and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, userId))
		)
		.where(
			and(eq(movie.id, id), eq(movie.status, 'ready'), eq(movie.missing, false), allowedMovies())
		);
	if (!film) error(404, 'Película no encontrada');
	// Only what is already known: looking it up is for the whole app's card.
	const [info, autoSubtitles, { apiKey }] = await Promise.all([
		savedMovieInfo(id),
		filmAutoSubtitles(id),
		chatConfig()
	]);
	const sagas = await Promise.all(
		(info?.sagas ?? []).map(async (saga) => ({ ...saga, films: await sagaFilms(saga.name, id) }))
	);
	return {
		film,
		info,
		sagas,
		autoSubtitles: autoSubtitles.map((s) => s.label),
		/** Asking about it by voice needs an OpenRouter key (and voice, `page.data.voice`). */
		canAsk: Boolean(apiKey)
	};
};

/** The saga's other films there are to watch, in its order. */
async function sagaFilms(name: string, except: number) {
	const films = await db
		.select({ id: movie.id, title: movieTitle, year: movie.year, sagas: movieInfo.sagas })
		.from(movieInfo)
		.innerJoin(movie, eq(movie.id, movieInfo.movieId))
		.where(
			and(
				sql`${movieInfo.sagas} @> ${JSON.stringify([{ name }])}::jsonb`,
				ne(movie.id, except),
				eq(movie.status, 'ready'),
				eq(movie.missing, false),
				allowedMovies()
			)
		);
	return films
		.map(({ sagas, ...film }) => ({
			...film,
			order: sagas.find((s) => s.name === name)?.order ?? null
		}))
		.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.year ?? 0) - (b.year ?? 0));
}

/** From where it was left, from the beginning (`from=start`) or from a scene (`at`), as in Cine. */
export const actions: Actions = { play };
