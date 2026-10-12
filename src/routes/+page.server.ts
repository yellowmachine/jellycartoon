import { and, desc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { dismissProgress } from '#lib/server/progress.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const [allSeries, continueWatching, today] = await Promise.all([
		db.execute<{
			id: number;
			title: string;
			total: number;
			ready: number;
			cover: number | null;
		}>(sql`
			select s.id, s.title,
				count(e.id)::int as total,
				count(e.id) filter (where e.status = 'ready')::int as ready,
				(select e2.id from ${episode} e2
					where e2.series_id = s.id and e2.status = 'ready' and not e2.missing
					order by e2.season, e2.number limit 1) as cover
			from ${series} s
			join ${episode} e on e.series_id = s.id and not e.missing
			group by s.id
			order by s.title
		`),
		db
			.select({
				id: episode.id,
				title: episodeTitle,
				season: episode.season,
				number: episode.number,
				seriesTitle: series.title,
				positionSec: watchProgress.positionSec,
				durationSec: episode.durationSec
			})
			.from(watchProgress)
			.innerJoin(
				episode,
				and(
					eq(episode.id, watchProgress.episodeId),
					eq(episode.status, 'ready'),
					eq(episode.missing, false)
				)
			)
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(
				and(
					eq(watchProgress.userId, userId),
					eq(watchProgress.completed, false),
					eq(watchProgress.dismissed, false)
				)
			)
			.orderBy(desc(watchProgress.updatedAt))
			.limit(8),
		getTodayPlaylist(userId)
	]);

	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		series: [...allSeries],
		continueWatching,
		today: today && {
			total: today.items.length,
			pending: pending.length,
			pendingSec: pending.reduce((sum, i) => sum + (i.durationSec ?? 0), 0),
			next: pending[0] ?? null
		}
	};
};

export const actions: Actions = {
	/** Out of «Seguir viendo»; where it was left is kept. */
	dismiss: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await dismissProgress(locals.user!.id, id);
	}
};
