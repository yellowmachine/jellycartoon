import { fail, type Action } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { hasIntro, hostIntroFile, hostMoviePath } from '#lib/server/library/paths.ts';
import { allowedMovies } from '#lib/server/kids.ts';
import { videoClosed } from '#lib/server/kid-time.ts';
import { getSettings } from '#lib/server/settings.ts';
import { log } from '#lib/server/log.ts';
import { mpvEnabled, play as playOnHost } from './mpv.ts';

/** Form actions shared by the Cine page and each film's page. */

/**
 * On the host's screen, from where it was left, from the beginning (`from=start`) or from a moment
 * (`at`, in seconds: a frame of the bird's-eye view).
 */
export const play: Action = async ({ request, locals }) => {
	const form = await request.formData();
	const at = Number(form.get('at'));
	return playFilm(
		locals.user!.id,
		Number(form.get('id')),
		form.has('at') && Number.isFinite(at) && at >= 0
			? { atSec: at }
			: form.get('from') === 'start'
				? 'start'
				: 'resume'
	);
};

/**
 * A film on the host's screen: also for voice commands. Only from the beginning does the Cine Club
 * intro go first, if the user wants it; not from a moment, even the first second.
 */
export async function playFilm(
	userId: string,
	id: number,
	from: 'resume' | 'start' | { atSec: number }
) {
	if (!mpvEnabled) return fail(400, { message: 'No hay mpv configurado (MPV_SOCKET)' });
	const closed = await videoClosed(userId);
	if (closed) return fail(403, { message: closed });
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
		.where(and(eq(movie.id, id), allowedMovies()));
	const hostPath = film && hostMoviePath(film.path);
	if (!film || !hostPath) return fail(400, { message: 'Película no válida' });

	const startSec =
		typeof from === 'object' ? from.atSec : from === 'start' ? 0 : (film.positionSec ?? 0);
	const settings = await getSettings(userId);
	const intro = startSec === 0 && typeof from !== 'object' && settings.intro && (await hasIntro());
	try {
		await playOnHost({
			userId,
			items: [
				{
					target: { movieId: film.id },
					title: film.title,
					subtitle: null,
					hostPath,
					startSec,
					durationSec: film.durationSec
				}
			],
			audioLang: settings.audioLang ?? AUDIO_LANG,
			subtitleLang: settings.subtitleLang,
			intro: intro ? hostIntroFile : null
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('mpv', `No se pudo reproducir ${film.path}`, { movieId: film.id, error: err });
		return fail(500, { message });
	}
	return { playing: film.title };
}

/** An empty title goes back to the one taken from the file name. */
export const rename: Action = async ({ request }) => {
	const form = await request.formData();
	const title = String(form.get('title') ?? '').trim();
	await db
		.update(movie)
		.set({ customTitle: title || null })
		.where(eq(movie.id, Number(form.get('id'))));
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
