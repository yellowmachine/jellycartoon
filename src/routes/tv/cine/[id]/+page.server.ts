import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { play } from '#lib/server/cinema/film-actions.ts';
import { savedMovieInfo } from '#lib/server/cinema/info.ts';
import { cinemaRoot } from '#lib/server/library/paths.ts';

/** A film's card on the TV: what it is, and to watch it. */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!mpvEnabled || !cinemaRoot) error(404, 'No hay películas que ver en el salón');
	const id = Number(params.id);
	const [film] = await db
		.select({
			id: movie.id,
			title: movieTitle,
			year: movie.year,
			durationSec: movie.durationSec,
			positionSec: movieProgress.positionSec,
			completed: movieProgress.completed
		})
		.from(movie)
		.leftJoin(
			movieProgress,
			and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, locals.user!.id))
		)
		.where(and(eq(movie.id, id), eq(movie.status, 'ready'), eq(movie.missing, false)));
	if (!film) error(404, 'Película no encontrada');
	// Only what is already known: looking it up is for the whole app's card.
	return { film, info: await savedMovieInfo(id) };
};

/** From where it was left, or from the beginning (`from=start`), as in Cine. */
export const actions: Actions = { play };
