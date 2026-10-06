import { error } from '@sveltejs/kit';
import { and, eq, gt, or, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, series, watchProgress } from '#lib/server/db/schema.ts';
import { getSettings } from '#lib/server/settings.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = Number(params.id);
	const [ep] = await db
		.select({
			id: episode.id,
			seriesId: episode.seriesId,
			season: episode.season,
			number: episode.number,
			title: episode.title,
			status: episode.status,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			seriesTitle: series.title,
			positionSec: watchProgress.positionSec
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, locals.user!.id))
		)
		.where(eq(episode.id, id));
	if (!ep || ep.status !== 'ready') error(404, 'Episodio no disponible');

	const [next] = await db
		.select({ id: episode.id })
		.from(episode)
		.where(
			and(
				eq(episode.seriesId, ep.seriesId),
				eq(episode.status, 'ready'),
				eq(episode.missing, false),
				or(
					gt(episode.season, ep.season),
					and(eq(episode.season, ep.season), gt(episode.number, ep.number))
				)
			)
		)
		.orderBy(asc(episode.season), asc(episode.number))
		.limit(1);

	return { episode: ep, nextId: next?.id ?? null, settings: await getSettings(locals.user!.id) };
};
