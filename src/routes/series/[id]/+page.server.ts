import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { deleteSeries } from '#lib/server/library/delete-series.ts';

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

	const seasons = Map.groupBy(episodes, (e) => e.season);
	return {
		series: s,
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
