import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { wakeCatalog } from '#lib/server/cinema/catalog.ts';
import { mpvEnabled, playMovie } from '#lib/server/cinema/mpv.ts';
import { scanCinema } from '#lib/server/cinema/scan.ts';
import { getSettings } from '#lib/server/settings.ts';
import { log } from '#lib/server/log.ts';
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
	/** On the host's screen, from where it was left or (`from=start`) from the beginning. */
	play: async ({ request, locals }) => {
		if (!mpvEnabled) return fail(400, { message: 'No hay mpv configurado (MPV_SOCKET)' });
		const form = await request.formData();
		const userId = locals.user!.id;
		const [film] = await db
			.select({
				id: movie.id,
				title: movieTitle,
				path: movie.path,
				durationSec: movie.durationSec,
				positionSec: movieProgress.positionSec
			})
			.from(movie)
			.leftJoin(
				movieProgress,
				and(eq(movieProgress.movieId, movie.id), eq(movieProgress.userId, userId))
			)
			.where(eq(movie.id, Number(form.get('id'))));
		const hostPath = film && hostMoviePath(film.path);
		if (!film || !hostPath) return fail(400, { message: 'Película no válida' });

		const settings = await getSettings(userId);
		try {
			await playMovie({
				userId,
				movieId: film.id,
				hostPath,
				startSec: form.get('from') === 'start' ? 0 : (film.positionSec ?? 0),
				durationSec: film.durationSec,
				audioLang: settings.audioLang ?? AUDIO_LANG,
				subtitleLang: settings.subtitleLang
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.error('mpv', `No se pudo reproducir ${film.path}`, { movieId: film.id, error: err });
			return fail(500, { message });
		}
		return { playing: film.title };
	},
	setWatched: async ({ request, locals }) => {
		const form = await request.formData();
		const movieId = Number(form.get('id'));
		const userId = locals.user!.id;
		if (form.get('watched') === 'true') {
			const values = { userId, movieId, positionSec: 0, completed: true, updatedAt: new Date() };
			await db
				.insert(movieProgress)
				.values(values)
				.onConflictDoUpdate({ target: [movieProgress.userId, movieProgress.movieId], set: values });
		} else {
			await db
				.delete(movieProgress)
				.where(and(eq(movieProgress.userId, userId), eq(movieProgress.movieId, movieId)));
		}
	},
	retry: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db
			.update(movie)
			.set({ status: 'pending', error: null })
			.where(and(eq(movie.id, id), eq(movie.status, 'error')));
		wakeCatalog();
	}
};
