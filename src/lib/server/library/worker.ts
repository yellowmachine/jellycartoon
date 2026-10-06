import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { DELETE_SOURCES } from '$app/env/private';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { languageLabel, normalizeLang, type SubtitleTrack } from '#lib/languages.ts';
import {
	probe,
	textSubtitleStreams,
	thumbnail,
	toWebVtt,
	transcodeHls,
	type Probe
} from './ffmpeg.ts';
import { hlsDir, legacyVideoFile, sourceFile, thumbFile } from './paths.ts';
import { removeSource, sidecarSubtitles } from './sources.ts';

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

async function extractSubtitles(input: string, outDir: string, info: Probe) {
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
			await toWebVtt(source.file, path.join(outDir, file), source.stream);
		} catch (error) {
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
			order by series_id, season, number
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
		const info = await probe(input);
		let lastWrite = 0;
		const { duration, audioTracks } = await transcodeHls(input, partial, info, (ratio) => {
			if (Date.now() - lastWrite < 2000) return;
			lastWrite = Date.now();
			db.update(episode)
				.set({ progress: ratio })
				.where(eq(episode.id, job.id))
				.catch(() => {});
		});
		const subtitles = await extractSubtitles(input, partial, info);

		await rm(output, { recursive: true, force: true });
		await rename(partial, output);
		await rm(legacyVideoFile(job.id), { force: true });
		await thumbnail(input, thumbFile(job.id), info, duration * 0.15);

		const size = await directorySize(output);
		await db
			.update(episode)
			.set({
				status: 'ready',
				progress: 1,
				durationSec: duration,
				outputSize: size,
				audioTracks,
				subtitles
			})
			.where(eq(episode.id, job.id));
		console.log(
			`[worker] #${job.id} listo (${(size / 1e6).toFixed(1)} MB, audio: ${audioTracks.map((t) => t.lang).join('/') || '—'}, subtítulos: ${subtitles.map((t) => t.lang).join('/') || '—'})`
		);
		if (DELETE_SOURCES) await deleteSourceAfterConversion(job);
	} catch (error) {
		await rm(partial, { recursive: true, force: true });
		await db
			.update(episode)
			.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
			.where(eq(episode.id, job.id));
		console.error(`[worker] #${job.id} error`, error);
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
