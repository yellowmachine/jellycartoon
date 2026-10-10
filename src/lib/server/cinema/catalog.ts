import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { describeStreams, probe, thumbnail } from '#lib/server/library/ffmpeg.ts';
import { movieFile, movieThumbFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

let running: Promise<void> | null = null;

/** Probes the films the scan found and takes their thumbnail, one at a time in the background. */
export function wakeCatalog() {
	running ??= catalogPending()
		.catch((error) => log.error('cine', 'Fallo inesperado al catalogar', { error }))
		.finally(() => (running = null));
}

async function catalogPending() {
	for (;;) {
		const [next] = await db
			.select({ id: movie.id, path: movie.path })
			.from(movie)
			.where(and(eq(movie.status, 'pending'), eq(movie.missing, false)))
			.limit(1);
		if (!next) return;

		try {
			// Not the worker's: it must not freeze when the conversion queue is paused.
			const info = await probe(movieFile(next.path), undefined, false);
			const durationSec = Number(info.format.duration) || null;
			const output = movieThumbFile(next.id);
			const partial = output.replace(/\.jpg$/, '.part.jpg');
			await mkdir(path.dirname(output), { recursive: true });
			try {
				// Past the opening credits.
				await thumbnail(movieFile(next.path), partial, info, (durationSec ?? 0) * 0.15, {
					pausable: false
				});
				await rename(partial, output);
			} finally {
				await rm(partial, { force: true });
			}
			await db
				.update(movie)
				.set({ status: 'ready', error: null, durationSec, ...describeStreams(info) })
				.where(eq(movie.id, next.id));
			log.info('cine', `Catalogada ${next.path}`, { movieId: next.id });
		} catch (error) {
			await db
				.update(movie)
				.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
				.where(eq(movie.id, next.id));
			log.error('cine', `No se pudo catalogar ${next.path}`, { movieId: next.id, error });
		}
	}
}
