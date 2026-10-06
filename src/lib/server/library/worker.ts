import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { transcode, thumbnail } from './ffmpeg.ts';
import { sourceFile, thumbFile, videoFile } from './paths.ts';

let started = false;
let wake: (() => void) | null = null;

/** Nudges the worker to look for pending episodes right away. */
export function wakeWorker() {
	wake?.();
}

export async function startWorker() {
	if (started) return;
	started = true;

	// Anything left half-done by a previous run starts over.
	await db
		.update(episode)
		.set({ status: 'pending', progress: 0 })
		.where(eq(episode.status, 'processing'));

	(async () => {
		while (true) {
			try {
				if (await processNext()) continue;
			} catch (error) {
				console.error('[worker]', error);
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 30_000);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			wake = null;
		}
	})();
}

async function processNext() {
	const [job] = await db.execute<{ id: number; source_path: string }>(sql`
		update ${episode} set status = 'processing', progress = 0, error = null, updated_at = now()
		where id = (
			select id from ${episode}
			where status = 'pending' and missing = false
			order by series_id, season, number
			limit 1
			for update skip locked
		)
		returning id, source_path
	`);
	if (!job) return false;

	const input = sourceFile(job.source_path);
	const output = videoFile(job.id);
	const partial = `${output}.part`;
	console.log(`[worker] #${job.id} ${job.source_path}`);

	try {
		await mkdir(path.dirname(output), { recursive: true });
		await mkdir(path.dirname(thumbFile(job.id)), { recursive: true });

		let lastWrite = 0;
		const { duration } = await transcode(input, partial, (ratio) => {
			if (Date.now() - lastWrite < 2000) return;
			lastWrite = Date.now();
			db.update(episode)
				.set({ progress: ratio })
				.where(eq(episode.id, job.id))
				.catch(() => {});
		});
		await rename(partial, output);
		await thumbnail(output, thumbFile(job.id), duration * 0.15);

		const { size } = await stat(output);
		await db
			.update(episode)
			.set({ status: 'ready', progress: 1, durationSec: duration, outputSize: size })
			.where(eq(episode.id, job.id));
		console.log(`[worker] #${job.id} listo (${(size / 1e6).toFixed(1)} MB)`);
	} catch (error) {
		await rm(partial, { force: true });
		await db
			.update(episode)
			.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
			.where(eq(episode.id, job.id));
		console.error(`[worker] #${job.id} error`, error);
	}
	return true;
}
