import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { deleteSeries } from '#lib/server/library/delete-series.ts';
import { deleteEpisodes } from '#lib/server/library/delete-episodes.ts';
import { hostPlaylist } from '#lib/server/library/paths.ts';
import { takeThumbnail } from '#lib/server/library/thumbnail.ts';
import { ignoreEpisodes, retryEpisode } from '#lib/server/library/worker.ts';
import { getActiveList, getListNames, seriesListItems, toggleInList } from '#lib/server/lists.ts';
import { clearProgress, markWatched, saveProgress } from '#lib/server/progress.ts';
import { log } from '#lib/server/log.ts';
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
	startProposal
} from '#lib/server/library/episode-titles.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
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
			subtitles: episode.subtitles
		})
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, locals.user!.id))
		)
		.where(and(eq(episode.seriesId, id), eq(episode.missing, false)))
		.orderBy(asc(episode.season), asc(episode.number));

	// What deleting the series frees up (missing episodes included: their files are there too).
	const [stored] = await db
		.select({
			episodes: sql<number>`count(*)::int`,
			outputBytes: sql<number>`coalesce(sum(${episode.outputSize}), 0)::bigint`
		})
		.from(episode)
		.where(eq(episode.seriesId, id));

	const [activeList, lists, listItems, saved, { apiKey }] = await Promise.all([
		getActiveList(locals.user!.id),
		getListNames(locals.user!.id),
		seriesListItems(locals.user!.id, id),
		savedSeriesInfo(id),
		openRouterConfig()
	]);

	const seasons = Map.groupBy(
		episodes.map((e) => ({ ...e, playlist: e.status === 'ready' ? hostPlaylist(e.id) : null })),
		(e) => e.season
	);
	return {
		series: s,
		activeList,
		lists,
		listItems,
		stored: { episodes: stored.episodes, outputBytes: Number(stored.outputBytes) },
		seasons: [...seasons].map(([season, episodes]) => ({ season, episodes })),
		/** Proposing titles needs an OpenRouter key. */
		canPropose: Boolean(apiKey),
		proposal: {
			...proposalState(id),
			rows: await proposalRows(id, saved?.titleProposal ?? [])
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
	proposeTitles: async ({ params }) => {
		startProposal(Number(params.id));
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
	renameSeries: async ({ params, request }) => {
		const title = String((await request.formData()).get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'El título no puede estar vacío' });
		await db
			.update(series)
			.set({ title })
			.where(eq(series.id, Number(params.id)));
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
	/** Every episode before this one in the series, in season and number order. */
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
			.where(
				and(
					eq(episode.seriesId, seriesId),
					eq(episode.missing, false),
					or(
						lt(episode.season, ep.season),
						and(eq(episode.season, ep.season), lt(episode.number, ep.number))
					)
				)
			);
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
				.orderBy(asc(episode.season), asc(episode.number));
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
