import { fail, type Action } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { hostMoviePath } from '#lib/server/library/paths.ts';
import { getSettings } from '#lib/server/settings.ts';
import { log } from '#lib/server/log.ts';
import { mpvEnabled, playMovie } from './mpv.ts';

/** Form actions shared by the Cine page and each film's page. */

/**
 * On the host's screen, from where it was left, from the beginning (`from=start`) or from a moment
 * (`at`, in seconds: a frame of the bird's-eye view).
 */
export const play: Action = async ({ request, locals }) => {
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

	const at = Number(form.get('at'));
	const startSec =
		form.has('at') && Number.isFinite(at) && at >= 0
			? at
			: form.get('from') === 'start'
				? 0
				: (film.positionSec ?? 0);
	const settings = await getSettings(userId);
	try {
		await playMovie({
			userId,
			movieId: film.id,
			title: film.title,
			hostPath,
			startSec,
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
};

export const setWatched: Action = async ({ request, locals }) => {
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
};
