import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { chatConfig } from '#lib/server/app-settings.ts';
import { chatHistory } from '#lib/server/cinema/chat.ts';
import { play, rename, setWatched } from '#lib/server/cinema/film-actions.ts';
import { choose, forget, identify, lookUp, savedMovieInfo } from '#lib/server/cinema/info.ts';
import { namingState, startNaming } from '#lib/server/cinema/scenes.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { cinemaRoot, hostMoviePath } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { addMovieTag, getTags, movieTags, removeMovieTag, tagName } from '#lib/server/tags.ts';
import {
	filmAutoSubtitles,
	requestSubtitles,
	subtitleJobs,
	tracksWithoutSubtitles
} from '#lib/server/auto-subtitles.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!cinemaRoot) error(404, 'No hay carpeta de películas (CINEMA_DIR)');
	const id = Number(params.id);
	const [film] = await db
		.select({
			id: movie.id,
			title: movieTitle,
			autoTitle: movie.title,
			year: movie.year,
			path: movie.path,
			size: movie.size,
			status: movie.status,
			durationSec: movie.durationSec,
			video: movie.video,
			audioTracks: movie.audioTracks,
			subtitles: movie.subtitles,
			chapters: movie.chapters,
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
	const [chat, { apiKey }, tags, allTags, autoSubtitles, jobs] = await Promise.all([
		chatHistory(locals.user!.id, id),
		chatConfig(),
		movieTags(id),
		getTags(),
		filmAutoSubtitles(id),
		voiceEnabled ? subtitleJobs('film', [id]) : null
	]);

	return {
		chat,
		tags,
		/** To suggest while typing a tag. */
		allTags: allTags.map((t) => t.name),
		/** Talking about the film needs an OpenRouter key. */
		canChat: Boolean(apiKey),
		naming: namingState(id),
		/**
		 * Subtitles made by Whisper (only with it, WHISPER_URL), which mpv adds: those there are,
		 * whether the film has audio in a language without its own, and how the last request goes.
		 */
		autoSubtitles: voiceEnabled
			? {
					made: autoSubtitles,
					languages: film.status === 'ready' ? tracksWithoutSubtitles(film) : [],
					job: jobs?.get(id) ?? null
				}
			: null,
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
	rename,
	setWatched,
	addTag: async ({ params, request }) => {
		const name = tagName(String((await request.formData()).get('name') ?? ''));
		if (!name) return fail(400, { message: 'Escribe una etiqueta' });
		if (name.length > 40) return fail(400, { message: 'Etiqueta demasiado larga' });
		await addMovieTag(Number(params.id), name);
	},
	removeTag: async ({ params, request }) => {
		const tagId = Number((await request.formData()).get('tagId'));
		if (!Number.isInteger(tagId)) return fail(400, { message: 'Etiqueta no válida' });
		await removeMovieTag(Number(params.id), tagId);
	},
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
	/** Name the chapters with the AI, in the background: the page asks until it is done. */
	nameScenes: async ({ params }) => {
		startNaming(Number(params.id));
	},
	/** In the background: the page follows how it goes (`autoSubtitles.job`). */
	autoSubtitles: async ({ params, request }) => {
		if (!voiceEnabled) return fail(400, { message: 'No hay Whisper configurado (WHISPER_URL)' });
		const lang = String((await request.formData()).get('lang') ?? '');
		await requestSubtitles('film', Number(params.id), lang);
	},
	/** Look it up again from scratch, e.g. after setting an OpenRouter key. */
	refresh: async ({ params }) => {
		await forget(Number(params.id));
	}
};
