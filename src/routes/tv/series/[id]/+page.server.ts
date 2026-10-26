import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { playEpisodes, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { savedSeriesInfo } from '#lib/server/library/series-info.ts';
import { episodeOrder } from '#lib/server/episode-order.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	const id = Number(params.id);
	const [s] = await db.select({ title: series.title }).from(series).where(eq(series.id, id));
	if (!s) error(404, 'Serie no encontrada');
	const episodes = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			durationSec: episode.durationSec,
			positionSec: watchProgress.positionSec,
			completed: watchProgress.completed
		})
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, locals.user!.id))
		)
		.where(and(eq(episode.seriesId, id), eq(episode.status, 'ready'), eq(episode.missing, false)))
		.orderBy(...episodeOrder);
	// Where to go on: the first one not finished, extras aside.
	const next = episodes.find((e) => e.season !== 0 && !e.completed) ?? null;
	// Only what is already known: looking it up is for the whole app's page.
	const info = await savedSeriesInfo(id);
	return {
		title: s.title,
		episodes,
		next,
		started: episodes.some((e) => e.positionSec),
		info: info && {
			originalTitle: info.originalTitle,
			startYear: info.startYear,
			endYear: info.endYear,
			seasons: info.seasons,
			episodes: info.episodes,
			synopsis: info.synopsis
		}
	};
};

export const actions: Actions = {
	/** The episode and, with «siguiente automático», the ones after it. */
	episode: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = Number((await request.formData()).get('id'));
		return playEpisodes(userId, await seriesQueue(userId, id));
	}
};
