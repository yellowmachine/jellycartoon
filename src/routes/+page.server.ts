import { sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, series, watchProgress } from '#lib/server/db/schema.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const [allSeries, continueWatching] = await Promise.all([
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
		db.execute<{
			id: number;
			title: string;
			season: number;
			number: number;
			series_title: string;
			position_sec: number;
			duration_sec: number;
		}>(sql`
			select e.id, e.title, e.season, e.number, s.title as series_title,
				p.position_sec, e.duration_sec
			from ${watchProgress} p
			join ${episode} e on e.id = p.episode_id and e.status = 'ready' and not e.missing
			join ${series} s on s.id = e.series_id
			where p.user_id = ${userId} and not p.completed
			order by p.updated_at desc
			limit 8
		`)
	]);

	return { series: [...allSeries], continueWatching: [...continueWatching] };
};
