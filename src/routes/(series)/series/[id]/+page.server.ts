import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { deleteSeries } from '#lib/server/library/delete-series.ts';
import { deleteEpisodes } from '#lib/server/library/delete-episodes.ts';
import { hostPlaylist } from '#lib/server/library/paths.ts';
import { takeThumbnail } from '#lib/server/library/thumbnail.ts';
import { ignoreEpisodes, retryEpisode, wakeWorker } from '#lib/server/library/worker.ts';
import { removeLight, requestLight } from '#lib/server/library/light.ts';
import { getActiveList, getListNames, seriesListItems, toggleInList } from '#lib/server/lists.ts';
import { clearProgress, markWatched, saveProgress } from '#lib/server/progress.ts';
import { log } from '#lib/server/log.ts';
import { parseView, viewCookie } from '#lib/views.ts';
import { addSeriesTag, getTags, removeSeriesTag, seriesTags, tagName } from '#lib/server/tags.ts';
import { playEpisodes, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import {
	cancelSubtitles,
	requestSubtitles,
	subtitleJobs,
	tracksWithoutSubtitles
} from '#lib/server/auto-subtitles.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { getSettings } from '#lib/server/settings.ts';
import { episodeOrder, episodesBefore } from '#lib/server/episode-order.ts';
import {
	cancelLabels,
	labelJobs,
	labelling,
	labelsOf,
	requestLabels
} from '#lib/server/episode-labels.ts';
import { assumeLanguage, KNOWN_LANGUAGES, normalizeLang } from 'comun/languages.ts';
import {
	chooseSeries,
	forgetSeries,
	identifySeries,
	lookUpSeries,
	savedSeriesInfo
} from '#lib/server/library/series-info.ts';
import {
	applyProposal,
	discardProposal,
	proposalRows,
	proposalState,
	startProposal,
	stopProposal
} from '#lib/server/library/episode-titles.ts';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	const id = Number(params.id);
	const [s] = await db.select().from(series).where(eq(series.id, id));
	if (!s) error(404, 'Serie no encontrada');

	const episodes = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			/** What an empty title goes back to. */
			autoTitle: sql<string>`coalesce(${episode.aiTitle}, ${episode.title})`,
			aiTitle: episode.aiTitle,
			status: episode.status,
			progress: episode.progress,
			durationSec: episode.durationSec,
			positionSec: watchProgress.positionSec,
			completed: watchProgress.completed,
			error: episode.error,
			sourcePath: episode.sourcePath,
			sourceSize: episode.sourceSize,
			sourceRemoved: episode.sourceRemoved,
			outputSize: episode.outputSize,
			convertSec: episode.convertSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			/** Its light version (light.ts): asked for, being made, there, or failed. */
			light: episode.light,
			lightError: episode.lightError
		})
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, locals.user!.id))
		)
		.where(and(eq(episode.seriesId, id), eq(episode.missing, false)))
		.orderBy(...episodeOrder);

	// What deleting the series frees up (missing episodes included: their files are there too).
	const [stored] = await db
		.select({
			episodes: sql<number>`count(*)::int`,
			outputBytes: sql<number>`coalesce(sum(${episode.outputSize}), 0)::bigint`
		})
		.from(episode)
		.where(eq(episode.seriesId, id));

	const [activeList, lists, listItems, saved, { apiKey }, tags, allTags] = await Promise.all([
		getActiveList(locals.user!.id),
		getListNames(locals.user!.id),
		seriesListItems(locals.user!.id, id),
		savedSeriesInfo(id),
		openRouterConfig(),
		seriesTags(id),
		getTags()
	]);

	const subtitleJobsNow = voiceEnabled
		? await subtitleJobs(
				'episode',
				episodes.map((e) => e.id)
			)
		: new Map();
	const ids = episodes.map((e) => e.id);
	const [labelsNow, labelJobsNow] = await Promise.all([labelsOf(ids), labelJobs(ids)]);
	const seasons = Map.groupBy(
		episodes.map((e) => ({
			...e,
			/** What the vision model saw in it (episode-labels.ts), and how its request goes. */
			labels: labelsNow.get(e.id) ?? [],
			labelJob: labelJobsNow.get(e.id) ?? null,
			playlist: e.status === 'ready' ? hostPlaylist(e.id) : null,
			/**
			 * Subtitles Whisper can make (only with it, WHISPER_URL): the languages of its audio
			 * without subtitles of their own, and how the last request is going.
			 */
			autoSubtitles: voiceEnabled
				? {
						languages: e.status === 'ready' ? tracksWithoutSubtitles(e) : [],
						job: subtitleJobsNow.get(e.id) ?? null
					}
				: null
		})),
		(e) => e.season
	);
	return {
		series: s,
		/** The audio chosen in Ajustes: «🎧 Escuchar» starts with that track (#154). */
		audioLang: (await getSettings(locals.user!.id)).audioLang,
		/**
		 * Some episode has audio whose file does not say its language, or it was assumed: the
		 * series' language can be set for them (`audioLang`).
		 */
		unmarkedAudio: episodes.some((e) => e.audioTracks.some((t) => t.lang === 'und' || t.assumed)),
		/** The languages to choose from, for the series' audio. */
		knownLanguages: KNOWN_LANGUAGES,
		view: parseView('episodes', cookies.get(viewCookie('episodes'))),
		tags,
		/** To suggest while typing a tag. */
		allTags: allTags.map((t) => t.name),
		activeList,
		lists,
		listItems,
		stored: { episodes: stored.episodes, outputBytes: Number(stored.outputBytes) },
		seasons: [...seasons].map(([season, episodes]) => ({ season, episodes })),
		/** «Etiquetar» needs Ollama (OLLAMA_URL) and a set of labels (Ajustes → Casa). */
		labelSets: (await labelling()).map((s) => ({ id: s.id, name: s.name })),
		/** Proposing titles needs an OpenRouter key. */
		canPropose: Boolean(apiKey),
		proposal: {
			...proposalState(id),
			rows: await proposalRows(id, saved?.titleProposal ?? []),
			/** Episodes that already have a title from the AI: proposing again leaves them out. */
			titled: episodes.filter((e) => e.aiTitle !== null).length,
			total: episodes.length
		},
		// Saved: in the page itself. The first time it is streamed: the page shows at once and the
		// info arrives when the lookup ends.
		info:
			saved ??
			lookUpSeries(id).catch((err) => {
				log.error('series', `No se pudo buscar la ficha de ${s.folder}`, {
					seriesId: id,
					error: err
				});
				return { failed: err instanceof Error ? err.message : String(err) };
			})
	};
};

export const actions: Actions = {
	/** «It is this one», among the candidates for the series' info. */
	chooseInfo: async ({ params, request }) => {
		const wikidataId = String((await request.formData()).get('wikidataId') ?? '');
		if (!/^Q\d+$/.test(wikidataId)) return fail(400, { message: 'Serie no válida' });
		try {
			await chooseSeries(Number(params.id), wikidataId);
		} catch (err) {
			return fail(502, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	/** Look the series up by a title typed by the user. */
	searchInfo: async ({ params, request }) => {
		const title = String((await request.formData()).get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'Escribe un título' });
		try {
			await identifySeries(Number(params.id), title);
		} catch (err) {
			return fail(502, { message: err instanceof Error ? err.message : String(err) });
		}
	},
	/** Look the series up again from scratch, e.g. after setting an OpenRouter key. */
	refreshInfo: async ({ params }) => {
		await forgetSeries(Number(params.id));
	},
	/** Titles and numbering from the AI, in the background: the page asks until it is done. */
	proposeTitles: async ({ params, request }) => {
		startProposal(Number(params.id), (await request.formData()).get('all') === 'true');
	},
	stopTitles: async ({ params }) => {
		stopProposal(Number(params.id));
	},
	/** The proposal, for the chosen episodes. */
	applyTitles: async ({ params, request }) => {
		const ids = (await request.formData()).getAll('id').map(Number);
		if (!ids.length || !ids.every(Number.isInteger))
			return fail(400, { message: 'No hay capítulos seleccionados' });
		await applyProposal(Number(params.id), ids);
	},
	discardTitles: async ({ params }) => {
		await discardProposal(Number(params.id));
	},
	delete: async ({ params }) => {
		await deleteSeries(Number(params.id));
		redirect(303, '/');
	},
	serialized: async ({ params, request }) => {
		const value = (await request.formData()).get('serialized') === 'true';
		await db
			.update(series)
			.set({ serialized: value })
			.where(eq(series.id, Number(params.id)));
	},
	/**
	 * The language of the audio whose file does not say it: for every episode now, and those
	 * converted later. Empty: unknown again.
	 */
	audioLang: async ({ params, request }) => {
		const value = String((await request.formData()).get('audioLang') ?? '');
		const lang = value ? normalizeLang(value) : null;
		if (lang && !KNOWN_LANGUAGES.includes(lang)) return fail(400, { message: 'Idioma no válido' });
		const seriesId = Number(params.id);
		await db.transaction(async (tx) => {
			await tx.update(series).set({ audioLang: lang }).where(eq(series.id, seriesId));
			const rows = await tx
				.select({ id: episode.id, audioTracks: episode.audioTracks })
				.from(episode)
				.where(eq(episode.seriesId, seriesId));
			for (const row of rows) {
				if (!row.audioTracks.some((t) => t.lang === 'und' || t.assumed)) continue;
				await tx
					.update(episode)
					.set({ audioTracks: assumeLanguage(row.audioTracks, lang) })
					.where(eq(episode.id, row.id));
			}
		});
		log.info('series', `Idioma del audio sin marcar: ${lang ?? 'desconocido'}`, { seriesId });
	},
	renameSeries: async ({ params, request }) => {
		const title = String((await request.formData()).get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'El título no puede estar vacío' });
		await db
			.update(series)
			.set({ title })
			.where(eq(series.id, Number(params.id)));
	},
	addTag: async ({ params, request }) => {
		const name = tagName(String((await request.formData()).get('name') ?? ''));
		if (!name) return fail(400, { message: 'Escribe una etiqueta' });
		if (name.length > 40) return fail(400, { message: 'Etiqueta demasiado larga' });
		await addSeriesTag(Number(params.id), name);
	},
	removeTag: async ({ params, request }) => {
		const tagId = Number((await request.formData()).get('tagId'));
		if (!Number.isInteger(tagId)) return fail(400, { message: 'Etiqueta no válida' });
		await removeSeriesTag(Number(params.id), tagId);
	},
	/** Into the given list, or the active one if none is given. */
	toggleList: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Capítulo no válido' });
		const listId = form.has('list')
			? Number(form.get('list'))
			: (await getActiveList(locals.user!.id))?.id;
		if (!Number.isInteger(listId)) return fail(400, { message: 'Lista no válida' });
		await toggleInList(locals.user!.id, listId!, id);
	},
	/** In the living room, with the ones after it; `from=start` starts it over. */
	salon: async ({ request, locals }) => {
		const form = await request.formData();
		const userId = locals.user!.id;
		const ids = await seriesQueue(userId, Number(form.get('id')));
		return playEpisodes(userId, ids, form.get('from') === 'start' ? 0 : undefined);
	},
	setWatched: async ({ params, request, locals }) => {
		const form = await request.formData();
		const ep = await seriesEpisode(params.id, form);
		if (!ep) return fail(400, { message: 'Capítulo no válido' });
		if (form.get('watched') === 'true') await saveProgress(locals.user!.id, ep.id, 0, true);
		else await clearProgress(locals.user!.id, ep.id);
	},
	retry: async ({ params, request }) => {
		const ep = await seriesEpisode(params.id, await request.formData());
		if (!ep) return fail(400, { message: 'Capítulo no válido' });
		await retryEpisode(ep.id);
	},
	ignore: async ({ params, request }) => {
		const ep = await seriesEpisode(params.id, await request.formData());
		if (!ep) return fail(400, { message: 'Capítulo no válido' });
		await ignoreEpisodes([ep.id]);
	},
	/** In the background: the page follows how it goes (`autoSubtitles.job`). */
	autoSubtitles: async ({ params, request }) => {
		if (!voiceEnabled) return fail(400, { message: 'No hay Whisper configurado (WHISPER_URL)' });
		const form = await request.formData();
		const ep = await seriesEpisode(params.id, form);
		if (!ep || ep.status !== 'ready') return fail(400, { message: 'Capítulo no válido' });
		await requestSubtitles('episode', ep.id, String(form.get('lang') ?? ''));
	},
	/**
	 * The selected episodes, in one language: each into the queue only if it has audio in it
	 * without subtitles of its own. Says how many went and how many were left out.
	 */
	autoSubtitlesMany: async ({ params, request }) => {
		if (!voiceEnabled) return fail(400, { message: 'No hay Whisper configurado (WHISPER_URL)' });
		const form = await request.formData();
		const lang = normalizeLang(String(form.get('lang') ?? ''));
		const ids = form.getAll('id').map(Number).filter(Number.isInteger);
		const rows = ids.length
			? await db
					.select({
						id: episode.id,
						status: episode.status,
						audioTracks: episode.audioTracks,
						subtitles: episode.subtitles
					})
					.from(episode)
					.where(and(eq(episode.seriesId, Number(params.id)), inArray(episode.id, ids)))
			: [];
		const wanted = rows.filter(
			(ep) => ep.status === 'ready' && tracksWithoutSubtitles(ep).some((t) => t.lang === lang)
		);
		// One waiting or being made for an episode is not asked for again: it counts as left out.
		let queued = 0;
		for (const ep of wanted) if (await requestSubtitles('episode', ep.id, lang)) queued++;
		return { subtitlesQueued: queued, subtitlesSkipped: ids.length - queued };
	},
	/** The selected converted ones get a light version (light.ts), made after the conversions. */
	lightMany: async ({ params, request }) => {
		const ids = await idsOfSeries(Number(params.id), await request.formData());
		const queued = await requestLight(ids);
		wakeWorker();
		return { lightQueued: queued, lightSkipped: ids.length - queued };
	},
	/** Their light versions deleted, or no longer asked for. */
	removeLightMany: async ({ params, request }) => {
		const ids = await idsOfSeries(Number(params.id), await request.formData());
		await removeLight(ids);
		return { lightRemoved: ids.length };
	},
	/** Those of this series still waiting; the one being made goes on. */
	cancelSubtitles: async ({ params }) => {
		const ids = await db
			.select({ id: episode.id })
			.from(episode)
			.where(eq(episode.seriesId, Number(params.id)));
		return {
			subtitlesCancelled: await cancelSubtitles(
				'episode',
				ids.map((e) => e.id)
			)
		};
	},
	/** The selected converted ones, into the labelling queue: the page follows how it goes. */
	labelMany: async ({ params, request }) => {
		const form = await request.formData();
		const setId = Number(form.get('labelSet'));
		const sets = await labelling();
		if (!sets.some((s) => s.id === setId))
			return fail(400, { message: 'Elige un conjunto de etiquetas (Ajustes → Casa)' });
		const ids = form.getAll('id').map(Number).filter(Number.isInteger);
		const ready = ids.length
			? await db
					.select({ id: episode.id })
					.from(episode)
					.where(
						and(
							eq(episode.seriesId, Number(params.id)),
							inArray(episode.id, ids),
							eq(episode.status, 'ready')
						)
					)
					.orderBy(asc(episode.season), asc(episode.number))
			: [];
		const queued = await requestLabels(
			ready.map((e) => e.id),
			setId
		);
		return { labelsQueued: queued, labelsSkipped: ids.length - queued };
	},
	/** Those of this series still waiting, and their failures; the one being labelled goes on. */
	cancelLabels: async ({ params }) => {
		const ids = await db
			.select({ id: episode.id })
			.from(episode)
			.where(eq(episode.seriesId, Number(params.id)));
		await cancelLabels(ids.map((e) => e.id));
	},
	regenerateThumbnail: async ({ params, request }) => {
		const ep = await seriesEpisode(params.id, await request.formData());
		if (!ep || ep.status !== 'ready' || !ep.durationSec)
			return fail(400, { message: 'Capítulo no válido' });
		try {
			// Somewhere in the middle: the start and end are usually credits.
			await takeThumbnail(ep.id, ep.durationSec * (0.1 + Math.random() * 0.7));
		} catch (err) {
			log.error('thumbnail', 'No se pudo sacar otra miniatura', { episodeId: ep.id, error: err });
			return fail(500, { message: 'No se pudo sacar la miniatura' });
		}
	},
	/** Every episode before this one in the series, in season and number order (extras apart). */
	markPreviousWatched: async ({ params, request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const seriesId = Number(params.id);
		const [ep] = await db
			.select({ season: episode.season, number: episode.number })
			.from(episode)
			.where(and(eq(episode.id, id), eq(episode.seriesId, seriesId)));
		if (!ep) return fail(400, { message: 'Capítulo no válido' });
		const previous = await db
			.select({ id: episode.id })
			.from(episode)
			.where(and(eq(episode.seriesId, seriesId), eq(episode.missing, false), episodesBefore(ep)));
		await markWatched(
			locals.user!.id,
			previous.map((e) => e.id)
		);
	},
	/**
	 * Moves the selected episodes to the end of another season, numbered in their current order.
	 * Scans no longer change their season and number.
	 */
	moveToSeason: async ({ params, request }) => {
		const form = await request.formData();
		const seriesId = Number(params.id);
		const season = Number(form.get('season'));
		const ids = form.getAll('id').map(Number);
		if (!Number.isInteger(season) || season < 0 || season > 999)
			return fail(400, { message: 'Temporada no válida' });
		if (!ids.length || !ids.every(Number.isInteger))
			return fail(400, { message: 'No hay capítulos seleccionados' });

		await db.transaction(async (tx) => {
			const selected = await tx
				.select({ id: episode.id })
				.from(episode)
				.where(and(eq(episode.seriesId, seriesId), inArray(episode.id, ids)))
				.orderBy(...episodeOrder);
			const [{ last }] = await tx
				.select({ last: sql<number>`coalesce(max(${episode.number}), 0)::int` })
				.from(episode)
				.where(
					and(
						eq(episode.seriesId, seriesId),
						eq(episode.season, season),
						notInArray(episode.id, ids)
					)
				);
			for (const [i, ep] of selected.entries()) {
				await tx
					.update(episode)
					.set({ season, number: last + i + 1, manualNumbering: true })
					.where(eq(episode.id, ep.id));
			}
		});
	},
	/** For good, originals included. */
	deleteEpisodes: async ({ params, request }) => {
		const ids = (await request.formData()).getAll('id').map(Number);
		if (!ids.length || !ids.every(Number.isInteger))
			return fail(400, { message: 'No hay capítulos seleccionados' });
		const { failed } = await deleteEpisodes(Number(params.id), ids);
		if (failed.length)
			return fail(500, {
				message: `No se pudo borrar el original de ${failed.length === 1 ? failed[0] : `${failed.length} capítulos`}: mira el Registro`
			});
	},
	/** An empty title goes back to the one taken from the file name. */
	renameEpisode: async ({ params, request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		await db
			.update(episode)
			.set({ customTitle: title || null })
			.where(and(eq(episode.id, Number(form.get('id'))), eq(episode.seriesId, Number(params.id))));
	}
};

/** The episode in the form's `id`, if it belongs to this series. */
async function seriesEpisode(seriesId: string, form: FormData) {
	const id = Number(form.get('id'));
	if (!Number.isInteger(id)) return null;
	const [ep] = await db
		.select({ id: episode.id, status: episode.status, durationSec: episode.durationSec })
		.from(episode)
		.where(and(eq(episode.id, id), eq(episode.seriesId, Number(seriesId))));
	return ep ?? null;
}

/** The selected ones (`id` in the form) that are of this series. */
async function idsOfSeries(seriesId: number, form: FormData) {
	const ids = form.getAll('id').map(Number).filter(Number.isInteger);
	if (!ids.length) return [];
	const rows = await db
		.select({ id: episode.id })
		.from(episode)
		.where(and(eq(episode.seriesId, seriesId), inArray(episode.id, ids)));
	return rows.map((r) => r.id);
}
