import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, series, watchProgress } from '#lib/server/db/schema.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = Number(params.id);
	const [s] = await db.select().from(series).where(eq(series.id, id));
	if (!s) error(404, 'Serie no encontrada');

	const episodes = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episode.title,
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

	const seasons = Map.groupBy(episodes, (e) => e.season);
	return { series: s, seasons: [...seasons].map(([season, episodes]) => ({ season, episodes })) };
};
