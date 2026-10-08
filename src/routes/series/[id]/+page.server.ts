import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { deleteSeries } from '#lib/server/library/delete-series.ts';
import { getActiveList, listEpisodeIds, toggleInActiveList } from '#lib/server/lists.ts';

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
			autoTitle: episode.title,
			status: episode.status,
			progress: episode.progress,
			durationSec: episode.durationSec,
			positionSec: watchProgress.positionSec,
			completed: watchProgress.completed
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

	const activeList = await getActiveList(locals.user!.id);
	const inList = activeList ? await listEpisodeIds(activeList.id) : [];

	const seasons = Map.groupBy(episodes, (e) => e.season);
	return {
		series: s,
		activeList,
		inList,
		stored: { episodes: stored.episodes, outputBytes: Number(stored.outputBytes) },
		seasons: [...seasons].map(([season, episodes]) => ({ season, episodes }))
	};
};

export const actions: Actions = {
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
	toggleList: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Capítulo no válido' });
		await toggleInActiveList(locals.user!.id, id);
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
