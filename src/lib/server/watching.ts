import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { allowedSeries } from '#lib/server/kids.ts';

/** What the home page and the TV view start with: the series, and what was left half watched. */

/** Every series, with how many episodes are ready and the first one's for a cover. */
export async function allSeries() {
	const allowed = allowedSeries();
	return [
		...(await db.execute<{
			id: number;
			title: string;
			total: number;
			ready: number;
			cover: number | null;
		}>(sql`
			select ${series.id} as id, ${series.title} as title,
				count(e.id)::int as total,
				count(e.id) filter (where e.status = 'ready')::int as ready,
				(select e2.id from ${episode} e2
					where e2.series_id = ${series.id} and e2.status = 'ready' and not e2.missing
					order by e2.season, e2.number limit 1) as cover
			from ${series}
			join ${episode} e on e.series_id = ${series.id} and not e.missing
			${allowed ? sql`where ${allowed}` : sql``}
			group by ${series.id}
			order by ${series.title}
		`))
	];
}

/** «Seguir viendo»: started, not finished nor taken out, the latest first. */
export function continueWatching(userId: string, limit = 8) {
	return db
		.select({
			id: episode.id,
			title: episodeTitle,
			season: episode.season,
			number: episode.number,
			seriesId: series.id,
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
				eq(watchProgress.dismissed, false),
				allowedSeries()
			)
		)
		.orderBy(desc(watchProgress.updatedAt))
		.limit(limit);
}
