import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DELETE_SOURCES } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { scanLibrary } from '#lib/server/library/scan.ts';
import {
	moveToFront,
	pauseWorker,
	restartCurrent,
	resumeWorker,
	stopWorker,
	wakeWorker,
	workerStatus
} from '#lib/server/library/worker.ts';
import { removeSource } from '#lib/server/library/sources.ts';
import { estimateQueue } from '#lib/server/library/estimate.ts';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const [totals] = await db
		.select({
			total: sql<number>`count(*)::int`,
			ready: sql<number>`count(*) filter (where ${episode.status} = 'ready')::int`,
			pending: sql<number>`count(*) filter (where ${episode.status} = 'pending')::int`,
			errors: sql<number>`count(*) filter (where ${episode.status} = 'error')::int`,
			sourceBytes: sql<number>`coalesce(sum(${episode.sourceSize}), 0)::bigint`,
			outputBytes: sql<number>`coalesce(sum(${episode.outputSize}), 0)::bigint`,
			/** Converted episodes whose original is still in MEDIA_DIR. */
			removable: sql<number>`count(*) filter (where ${episode.status} = 'ready' and not ${episode.sourceRemoved})::int`,
			removableBytes: sql<number>`coalesce(sum(${episode.sourceSize}) filter (where ${episode.status} = 'ready' and not ${episode.sourceRemoved}), 0)::bigint`
		})
		.from(episode)
		.where(eq(episode.missing, false));

	const active = await db
		.select({ id: episode.id, progress: episode.progress, sourcePath: episode.sourcePath })
		.from(episode)
		.where(and(eq(episode.status, 'processing'), eq(episode.missing, false)));

	const failed = await db
		.select({
			id: episode.id,
			status: episode.status,
			error: episode.error,
			sourcePath: episode.sourcePath
		})
		.from(episode)
		.where(sql`${episode.status} in ('error', 'ignored') and not ${episode.missing}`)
		.orderBy(asc(episode.sourcePath));

	// Same order as the worker takes them.
	const queue = await db
		.select({
			id: episode.id,
			sourcePath: episode.sourcePath,
			seriesId: episode.seriesId,
			seriesTitle: series.title,
			durationSec: episode.durationSec
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(and(eq(episode.status, 'pending'), eq(episode.missing, false)))
		.orderBy(
			desc(episode.priority),
			asc(episode.seriesId),
			asc(episode.season),
			asc(episode.number)
		);

	// Seconds of video converted per second, over the latest conversions.
	const recent = db
		.select({ durationSec: episode.durationSec, convertSec: episode.convertSec })
		.from(episode)
		.where(
			sql`${episode.status} = 'ready' and ${episode.convertSec} > 0 and ${episode.durationSec} > 0`
		)
		.orderBy(desc(episode.updatedAt))
		.limit(20)
		.as('recent');
	const [{ speed }] = await db
		.select({ speed: sql<number | null>`sum(${recent.durationSec}) / sum(${recent.convertSec})` })
		.from(recent);

	const worker = workerStatus();
	const processing = active.find((e) => e.id === worker.currentId);
	const queueEta =
		worker.state === 'running'
			? estimateQueue({
					speed,
					current: processing
						? {
								durationSec: worker.currentDurationSec,
								elapsedSec: worker.currentElapsedSec,
								progress: processing.progress
							}
						: null,
					pending: queue.map((e) => e.durationSec)
				})
			: null;

	return {
		worker,
		queueEta,
		queue,
		totals: {
			...totals,
			sourceBytes: Number(totals.sourceBytes),
			outputBytes: Number(totals.outputBytes),
			removableBytes: Number(totals.removableBytes)
		},
		active,
		errors: failed.filter((e) => e.status === 'error'),
		ignored: failed.filter((e) => e.status === 'ignored'),
		deleteSources: DELETE_SOURCES
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
	/** For episodes converted before DELETE_SOURCES was enabled. */
	removeSources: async () => {
		if (!DELETE_SOURCES) return fail(400, { message: 'DELETE_SOURCES no está activado' });
		const candidates = await db
			.select({
				id: episode.id,
				sourcePath: episode.sourcePath,
				sourceSize: episode.sourceSize,
				sourceMtime: episode.sourceMtime
			})
			.from(episode)
			.where(
				and(
					eq(episode.status, 'ready'),
					eq(episode.sourceRemoved, false),
					eq(episode.missing, false)
				)
			);

		const counts = { removed: 0, skipped: 0 };
		for (const ep of candidates) {
			const result = await removeSource(ep).catch(() => 'failed' as const);
			if (result === 'removed') counts.removed++;
			else counts.skipped++;
		}
		return { removed: counts };
	},
	resume: async () => {
		await resumeWorker();
	},
	pause: async () => {
		await pauseWorker();
	},
	stop: async () => {
		await stopWorker();
	},
	restart: async () => {
		await restartCurrent();
	},
	moveToFront: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Episodio no válido' });
		await moveToFront(id);
	},
	/** Back to the queue: one failed or ignored episode. */
	retryOne: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Episodio no válido' });
		await db
			.update(episode)
			.set({ status: 'pending', error: null })
			.where(and(eq(episode.id, id), sql`${episode.status} in ('error', 'ignored')`));
		wakeWorker();
	},
	/** Sets a failed episode aside: hidden and not retried until its file changes. */
	ignore: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Episodio no válido' });
		await db
			.update(episode)
			.set({ status: 'ignored' })
			.where(and(eq(episode.id, id), eq(episode.status, 'error')));
	},
	retry: async () => {
		await db
			.update(episode)
			.set({ status: 'pending', error: null })
			.where(eq(episode.status, 'error'));
		wakeWorker();
	}
};
