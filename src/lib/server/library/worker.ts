import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { DELETE_SOURCES } from '$app/env/private';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, worker } from '#lib/server/db/schema.ts';
import { languageLabel, normalizeLang, type SubtitleTrack } from '#lib/languages.ts';
import {
	probe,
	setSuspended,
	textSubtitleStreams,
	thumbnail,
	toWebVtt,
	transcodeHls,
	type Probe
} from './ffmpeg.ts';
import { hlsDir, legacyVideoFile, removeEpisodeOutput, sourceFile, thumbFile } from './paths.ts';
import { removeSource, sidecarSubtitles } from './sources.ts';

export type WorkerState = (typeof worker.$inferSelect)['state'];

let started = false;
let state: WorkerState = 'running';
let wake: (() => void) | null = null;
/** The episode being converted, how to cancel it and how long it has been converting. */
let current: {
	id: number;
	abort: AbortController;
	durationSec: number | null;
	/** Converting time before the last pause. */
	activeMs: number;
	/** Null while paused. */
	runningSince: number | null;
} | null = null;

/** Seconds spent converting the current episode, not counting pauses. */
function activeSeconds() {
	if (!current) return 0;
	const running = current.runningSince === null ? 0 : Date.now() - current.runningSince;
	return (current.activeMs + running) / 1000;
}

/** Nudges the worker to look for pending episodes right away. */
export function wakeWorker() {
	wake?.();
}

export function workerStatus() {
	return {
		state,
		currentId: current?.id ?? null,
		currentDurationSec: current?.durationSec ?? null,
		currentElapsedSec: activeSeconds()
	};
}

async function setState(next: WorkerState) {
	state = next;
	await db
		.insert(worker)
		.values({ id: 1, state })
		.onConflictDoUpdate({ target: worker.id, set: { state } });
}

/** Takes pending episodes again; resumes a paused conversion where it was. */
export async function resumeWorker() {
	await setState('running');
	setSuspended(false);
	if (current && current.runningSince === null) current.runningSince = Date.now();
	wakeWorker();
}

/** Freezes the current conversion (keeps its progress) and starts nothing new. */
export async function pauseWorker() {
	if (state !== 'running') return;
	await setState('paused');
	setSuspended(true);
	if (current && current.runningSince !== null) {
		current.activeMs += Date.now() - current.runningSince;
		current.runningSince = null;
	}
}

/** Cancels the current conversion (back to the queue) and starts nothing new. */
export async function stopWorker() {
	await setState('stopped');
	current?.abort.abort();
	setSuspended(false);
}

/** Converts the current episode again from scratch. */
export async function restartCurrent() {
	if (!current) return;
	await moveToFront(current.id);
	current.abort.abort();
}

/** Cancels the conversion in progress if it is one of these episodes (e.g. they were deleted). */
export function cancelEpisodes(ids: number[]) {
	if (current && ids.includes(current.id)) current.abort.abort();
}

/** The episode is converted next, after the current one. */
export async function moveToFront(id: number) {
	await db
		.update(episode)
		.set({ priority: sql`(select coalesce(max(${episode.priority}), 0) + 1 from ${episode})` })
		.where(and(eq(episode.id, id), sql`${episode.status} in ('pending', 'processing')`));
	wakeWorker();
}

export async function startWorker() {
	if (started) return;
	started = true;

	const [saved] = await db.select({ state: worker.state }).from(worker);
	state = saved?.state ?? 'running';

	// Anything left half-done by a previous run starts over.
	await db
		.update(episode)
		.set({ status: 'pending', progress: 0 })
		.where(eq(episode.status, 'processing'));

	(async () => {
		while (true) {
			try {
				if (state === 'running' && (await processNext())) continue;
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

async function extractSubtitles(input: string, outDir: string, info: Probe, signal: AbortSignal) {
	const sources = [
		...textSubtitleStreams(info).map((s) => ({
			file: input,
			stream: s.index,
			lang: s.tags?.language
		})),
		...(await sidecarSubtitles(input)).map((s) => ({ ...s, stream: undefined }))
	];

	const tracks: SubtitleTrack[] = [];
	for (const [i, source] of sources.entries()) {
		const lang = normalizeLang(source.lang);
		const file = `sub_${i}_${lang}.vtt`;
		try {
			await toWebVtt(source.file, path.join(outDir, file), source.stream, signal);
		} catch (error) {
			if (signal.aborted) throw error;
			console.warn(`[worker] subtítulo ${source.file} (${lang}) descartado`, error);
			continue;
		}
		const sameLang = tracks.filter((t) => t.lang === lang).length;
		tracks.push({
			lang,
			label: languageLabel(lang) + (sameLang ? ` (${sameLang + 1})` : ''),
			file
		});
	}
	return tracks;
}

async function directorySize(dir: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		total += entry.isDirectory() ? await directorySize(full) : (await stat(full)).size;
	}
	return total;
}

async function processNext() {
	const [claimed] = await db.execute<{ id: number }>(sql`
		update ${episode} set status = 'processing', progress = 0, error = null, updated_at = now()
		where id = (
			select id from ${episode}
			where status = 'pending' and missing = false
			order by priority desc, series_id, season, number
			limit 1
			for update skip locked
		)
		returning id
	`);
	if (!claimed) return false;

	// Read through Drizzle: raw rows would parse the UTC `timestamp` as local time.
	const [job] = await db
		.select({
			id: episode.id,
			sourcePath: episode.sourcePath,
			sourceSize: episode.sourceSize,
			sourceMtime: episode.sourceMtime
		})
		.from(episode)
		.where(eq(episode.id, claimed.id));

	const abort = new AbortController();
	const { signal } = abort;
	current = { id: job.id, abort, durationSec: null, activeMs: 0, runningSince: Date.now() };

	const input = sourceFile(job.sourcePath);
	const output = hlsDir(job.id);
	const partial = `${output}.part`;
	console.log(`[worker] #${job.id} ${job.sourcePath}`);

	try {
		await rm(partial, { recursive: true, force: true });
		await mkdir(partial, { recursive: true });
		await mkdir(path.dirname(thumbFile(job.id)), { recursive: true });

		await access(input).catch(() => {
			throw new Error(
				'No se encuentra el original. Si se borró tras convertirlo, cópialo de nuevo a la carpeta de medios.'
			);
		});
		const info = await probe(input, signal);
		current.durationSec = Number(info.format.duration) || null;
		let lastWrite = 0;
		const { duration, audioTracks } = await transcodeHls(
			input,
			partial,
			info,
			(ratio) => {
				if (Date.now() - lastWrite < 2000) return;
				lastWrite = Date.now();
				db.update(episode)
					.set({ progress: ratio })
					.where(eq(episode.id, job.id))
					.catch(() => {});
			},
			signal
		);
		const subtitles = await extractSubtitles(input, partial, info, signal);
		signal.throwIfAborted();

		await rm(output, { recursive: true, force: true });
		await rename(partial, output);
		await rm(legacyVideoFile(job.id), { force: true });
		await thumbnail(input, thumbFile(job.id), info, duration * 0.15, signal);

		const size = await directorySize(output);
		const [updated] = await db
			.update(episode)
			.set({
				status: 'ready',
				progress: 1,
				priority: 0,
				durationSec: duration,
				convertSec: activeSeconds(),
				outputSize: size,
				audioTracks,
				subtitles
			})
			.where(eq(episode.id, job.id))
			.returning({ id: episode.id });
		if (!updated) {
			// The series was deleted while converting.
			await removeEpisodeOutput(job.id);
			return true;
		}
		console.log(
			`[worker] #${job.id} listo (${(size / 1e6).toFixed(1)} MB, audio: ${audioTracks.map((t) => t.lang).join('/') || '—'}, subtítulos: ${subtitles.map((t) => t.lang).join('/') || '—'})`
		);
		if (DELETE_SOURCES) await deleteSourceAfterConversion(job);
	} catch (error) {
		await rm(partial, { recursive: true, force: true });
		if (signal.aborted) {
			// Stopped or restarted from the library page: back to the queue, not an error.
			const [requeued] = await db
				.update(episode)
				.set({ status: 'pending', progress: 0 })
				.where(eq(episode.id, job.id))
				.returning({ id: episode.id });
			// Gone means its series was deleted: drop whatever was already written.
			if (!requeued) await removeEpisodeOutput(job.id);
			console.log(`[worker] #${job.id} cancelado`);
		} else {
			await db
				.update(episode)
				.set({
					status: 'error',
					error: error instanceof Error ? error.message : String(error),
					priority: 0
				})
				.where(eq(episode.id, job.id));
			console.error(`[worker] #${job.id} error`, error);
		}
	} finally {
		current = null;
	}
	return true;
}

async function deleteSourceAfterConversion(job: {
	id: number;
	sourcePath: string;
	sourceSize: number;
	sourceMtime: Date;
}) {
	try {
		const result = await removeSource(job);
		if (result === 'removed') {
			console.log(`[worker] #${job.id} original borrado: ${job.sourcePath}`);
		} else if (result === 'changed') {
			const info = await stat(sourceFile(job.sourcePath));
			if (Date.now() - info.mtime.getTime() >= 60_000) {
				// Not being written to, so this isn't a copy in progress: keep the original rather
				// than risk converting the same file in a loop.
				console.warn(`[worker] #${job.id} el original no coincide con lo convertido; no se borra`);
				return;
			}
			// Still being copied: convert the final file again once it settles.
			console.warn(`[worker] #${job.id} el original cambió durante la conversión; se repite`);
			await db
				.update(episode)
				.set({ status: 'pending', progress: 0, sourceSize: info.size, sourceMtime: info.mtime })
				.where(eq(episode.id, job.id));
		}
	} catch (error) {
		console.warn(`[worker] #${job.id} no se pudo borrar el original`, error);
	}
}
