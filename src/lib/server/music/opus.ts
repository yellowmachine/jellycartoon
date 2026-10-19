import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { probeDuration, toOpus } from '#lib/server/library/ffmpeg.ts';
import { musicFile, opusFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

let running: Promise<void> | null = null;

/**
 * Makes the Opus copies of the tracks without one (#64), one at a time in the background: a couple
 * of seconds each. The FLAC is played until its copy is ready. Resolves when there is nothing left.
 */
export function wakeOpus() {
	running ??= convertPending()
		.catch((error) => log.error('música', 'Fallo inesperado al comprimir la música', { error }))
		.finally(() => (running = null));
	return running;
}

async function convertPending() {
	// Said once, when done: a line per track would fill the Registro.
	const done = { ready: 0, errors: 0 };
	for (;;) {
		const [next] = await db
			.select({
				id: track.id,
				path: track.path,
				mtime: track.mtime,
				durationSec: track.durationSec
			})
			.from(track)
			.where(and(eq(track.status, 'ready'), eq(track.missing, false), eq(track.opus, 'pending')))
			.orderBy(asc(track.id))
			.limit(1);
		if (!next) {
			if (done.ready || done.errors)
				log.info(
					'música',
					`Comprimidas en Opus ${done.ready} pistas${done.errors ? ` (${done.errors} con error)` : ''}`,
					{ ...done }
				);
			return;
		}

		const output = opusFile(next.id);
		// Written apart and then moved, so that one cut halfway is never played.
		const part = `${output}.part`;
		// The same file as when it was picked: if the scan found it changed meanwhile, it stays
		// pending and is made again.
		const same = and(eq(track.id, next.id), eq(track.mtime, next.mtime));
		try {
			await mkdir(path.dirname(output), { recursive: true });
			await toOpus(musicFile(next.path), part);
			// ffmpeg can end well with less than the whole track: it must last what the FLAC does.
			const duration = await probeDuration(part);
			if (!duration || (next.durationSec && Math.abs(duration - next.durationSec) > 1))
				throw new Error(
					`ffmpeg sacó ${duration ? `${Math.round(duration)} s` : 'un audio vacío'} en vez de ${Math.round(next.durationSec ?? 0)} s`
				);
			await rename(part, output);
			await db.update(track).set({ opus: 'ready', opusError: null }).where(same);
			done.ready++;
		} catch (error) {
			await rm(part, { force: true });
			await db
				.update(track)
				.set({ opus: 'error', opusError: error instanceof Error ? error.message : String(error) })
				.where(same);
			done.errors++;
			log.error('música', `No se pudo comprimir en Opus ${next.path}`, { trackId: next.id, error });
		}
	}
}
