import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { wakeCatalog } from '#lib/server/cinema/catalog.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { play, setWatched } from '#lib/server/cinema/film-actions.ts';
import { scanCinema } from '#lib/server/cinema/scan.ts';
import { cinemaRoot, hostMoviePath } from '#lib/server/library/paths.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!cinemaRoot) error(404, 'No hay carpeta de películas (CINEMA_DIR)');

	const movies = await db
		.select({
			id: movie.id,
			title: movieTitle,
			autoTitle: movie.title,
			year: movie.year,
			path: movie.path,
			size: movie.size,
			status: movie.status,
			error: movie.error,
			durationSec: movie.durationSec,
			video: movie.video,
			audioTracks: movie.audioTracks,
			subtitles: movie.subtitles,
			positionSec: movieProgress.positionSec,
			completed: movieProgress.completed
		})
		.from(movie)
		.leftJoin(
			movieProgress,
			and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, locals.user!.id))
		)
		.where(eq(movie.missing, false));

	return {
		movies: movies
			.map((m) => ({ ...m, hostPath: hostMoviePath(m.path) }))
			.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })),
		pending: movies.filter((m) => m.status === 'pending').length,
		/** Whether films can be played on the host's screen. */
		mpv: mpvEnabled
	};
};

export const actions: Actions = {
	scan: async () => {
		try {
			return { scan: await scanCinema() };
		} catch (err) {
			return fail(500, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	/** An empty title goes back to the one taken from the file name. */
	rename: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		await db
			.update(movie)
			.set({ customTitle: title || null })
			.where(eq(movie.id, Number(form.get('id'))));
	},
	play,
	setWatched,
	retry: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db
			.update(movie)
			.set({ status: 'pending', error: null })
			.where(and(eq(movie.id, id), eq(movie.status, 'error')));
		wakeCatalog();
	}
};
