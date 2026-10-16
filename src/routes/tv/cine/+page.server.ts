import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { cinemaRoot } from '#lib/server/library/paths.ts';
import { allowedMovies } from '#lib/server/kids.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!mpvEnabled || !cinemaRoot) error(404, 'No hay películas que ver en el salón');
	const films = await db
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
		.where(and(eq(movie.status, 'ready'), eq(movie.missing, false), allowedMovies()));
	const started = (f: (typeof films)[number]) => !f.completed && (f.positionSec ?? 0) > 0;
	return {
		// The ones half watched first, then all by title.
		films: films.sort(
			(a, b) =>
				Number(started(b)) - Number(started(a)) ||
				a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
		)
	};
};
