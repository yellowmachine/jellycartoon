import { error, fail } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieInfo, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { wakeCatalog } from '#lib/server/cinema/catalog.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { play, rename, setWatched } from '#lib/server/cinema/film-actions.ts';
import { scanFilms } from '#lib/server/library/nightly.ts';
import { cinemaRoot, hostMoviePath } from '#lib/server/library/paths.ts';
import { allowedMovies } from '#lib/server/kids.ts';
import { extrasProgress } from '#lib/server/cinema/info.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!cinemaRoot) error(404, 'No hay carpeta de películas (CINEMA_DIR)');

	const movies = await db
		.select({
			id: movie.id,
			title: movieTitle,
			autoTitle: movie.title,
			// The one in its info, when it has one: the file name's may be missing or wrong.
			year: sql<number | null>`coalesce(${movieInfo.year}, ${movie.year})`,
			/** For «añadidas hace poco». */
			addedAt: movie.createdAt,
			path: movie.path,
			size: movie.size,
			status: movie.status,
			error: movie.error,
			durationSec: movie.durationSec,
			video: movie.video,
			audioTracks: movie.audioTracks,
			subtitles: movie.subtitles,
			positionSec: movieProgress.positionSec,
			completed: movieProgress.completed,
			infoStatus: movieInfo.status,
			originalTitle: movieInfo.originalTitle,
			directors: movieInfo.directors,
			cast: movieInfo.cast,
			genres: movieInfo.genres,
			countries: movieInfo.countries,
			awards: movieInfo.awards,
			sagas: movieInfo.sagas,
			writers: movieInfo.writers,
			composers: movieInfo.composers,
			cinematographers: movieInfo.cinematographers,
			blackAndWhite: movieInfo.blackAndWhite,
			silent: movieInfo.silent
		})
		.from(movie)
		.leftJoin(
			movieProgress,
			and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, locals.user!.id))
		)
		.leftJoin(movieInfo, eq(movieInfo.movieId, movie.id))
		.where(and(eq(movie.missing, false), allowedMovies()));

	return {
		movies: movies
			.map((m) => ({
				...m,
				// Films not looked up yet have no info.
				directors: m.directors ?? [],
				cast: m.cast ?? [],
				genres: m.genres ?? [],
				countries: m.countries ?? [],
				awards: m.awards ?? [],
				sagas: m.sagas ?? [],
				writers: m.writers ?? [],
				composers: m.composers ?? [],
				cinematographers: m.cinematographers ?? [],
				blackAndWhite: m.blackAndWhite ?? false,
				silent: m.silent ?? false,
				hostPath: hostMoviePath(m.path)
			}))
			.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })),
		pending: movies.filter((m) => m.status === 'pending').length,
		/** Catalogued films without info yet: looked up after a scan, or when opened. */
		withoutInfo: movies.filter((m) => m.status === 'ready' && !m.infoStatus).length,
		/** Whether films can be played on the host's screen. */
		mpv: mpvEnabled,
		/** Info found before awards, sagas and crew were read, being completed in the background. */
		extras: { ...extrasProgress }
	};
};

export const actions: Actions = {
	scan: async () => {
		try {
			return { scan: await scanFilms() };
		} catch (err) {
			return fail(500, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	rename,
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
