import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { play, setWatched } from '#lib/server/cinema/film-actions.ts';
import { choose, forget, identify, lookUp, savedMovieInfo } from '#lib/server/cinema/info.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { cinemaRoot, hostMoviePath } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!cinemaRoot) error(404, 'No hay carpeta de películas (CINEMA_DIR)');
	const id = Number(params.id);
	const [film] = await db
		.select({
			id: movie.id,
			title: movieTitle,
			year: movie.year,
			path: movie.path,
			size: movie.size,
			status: movie.status,
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
		.where(and(eq(movie.id, id), eq(movie.missing, false)));
	if (!film) error(404, 'Película no encontrada');

	return {
		film: { ...film, hostPath: hostMoviePath(film.path) },
		mpv: mpvEnabled,
		// Saved: in the page itself. The first time it is streamed: the page shows at once and the
		// info arrives when the lookup ends.
		info:
			(await savedMovieInfo(id)) ??
			lookUp(id).catch((err) => {
				log.error('cine', `No se pudo buscar la ficha de ${film.path}`, {
					movieId: id,
					error: err
				});
				return { failed: err instanceof Error ? err.message : String(err) };
			})
	};
};

export const actions: Actions = {
	play,
	setWatched,
	/** «It is this one», among the candidates. */
	choose: async ({ params, request }) => {
		const wikidataId = String((await request.formData()).get('wikidataId') ?? '');
		if (!/^Q\d+$/.test(wikidataId)) return fail(400, { message: 'Película no válida' });
		try {
			await choose(Number(params.id), wikidataId);
		} catch (err) {
			return fail(502, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	/** Look it up by a title typed by the user. */
	search: async ({ params, request }) => {
		const title = String((await request.formData()).get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'Escribe un título' });
		try {
			await identify(Number(params.id), title);
		} catch (err) {
			return fail(502, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	/** Look it up again from scratch, e.g. after setting an OpenRouter key. */
	refresh: async ({ params }) => {
		await forget(Number(params.id));
	}
};
