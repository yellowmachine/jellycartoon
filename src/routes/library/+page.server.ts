import { asc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { scanLibrary } from '#lib/server/library/scan.ts';
import { wakeWorker } from '#lib/server/library/worker.ts';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const [totals] = await db
		.select({
			total: sql<number>`count(*)::int`,
			ready: sql<number>`count(*) filter (where ${episode.status} = 'ready')::int`,
			pending: sql<number>`count(*) filter (where ${episode.status} = 'pending')::int`,
			errors: sql<number>`count(*) filter (where ${episode.status} = 'error')::int`,
			sourceBytes: sql<number>`coalesce(sum(${episode.sourceSize}), 0)::bigint`,
			outputBytes: sql<number>`coalesce(sum(${episode.outputSize}), 0)::bigint`
		})
		.from(episode)
		.where(eq(episode.missing, false));

	const active = await db
		.select({
			id: episode.id,
			status: episode.status,
			progress: episode.progress,
			error: episode.error,
			sourcePath: episode.sourcePath,
			seriesTitle: series.title
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(sql`${episode.status} in ('processing', 'error') and not ${episode.missing}`)
		.orderBy(asc(episode.status), asc(episode.sourcePath));

	return {
		totals: {
			...totals,
			sourceBytes: Number(totals.sourceBytes),
			outputBytes: Number(totals.outputBytes)
		},
		active
	};
};

export const actions: Actions = {
	scan: async () => {
		try {
			return { scan: await scanLibrary() };
		} catch (error) {
			return fail(500, { message: error instanceof Error ? error.message : String(error) });
		}
	},
	retry: async () => {
		await db
			.update(episode)
			.set({ status: 'pending', error: null })
			.where(eq(episode.status, 'error'));
		wakeWorker();
	}
};
