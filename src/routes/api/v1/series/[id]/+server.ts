import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { episodeOrder } from '#lib/server/episode-order.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** The video API (#253): a series' episodes ready to watch, with where this person left each. */
export const GET: RequestHandler = async ({ request, params }) => {
	const person = await cloudPerson(request);
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
			light: episode.light,
			positionSec: watchProgress.positionSec,
			completed: watchProgress.completed
		})
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, person.id))
		)
		.where(and(eq(episode.seriesId, id), eq(episode.status, 'ready'), eq(episode.missing, false)))
		.orderBy(...episodeOrder);
	return json({
		id,
		title: s.title,
		episodes: episodes.map((e) => ({
			id: e.id,
			season: e.season,
			number: e.number,
			title: e.title,
			durationSec: e.durationSec,
			/** Whether it has the 720p version, the one given by default. */
			light: e.light === 'ready',
			positionSec: e.positionSec ?? 0,
			completed: e.completed ?? false
		}))
	});
};
