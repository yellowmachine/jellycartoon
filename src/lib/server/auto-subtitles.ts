import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNotNull, max, min, notInArray, sql } from 'drizzle-orm';
import { setSubtitlesPaused, subtitlesPaused } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieTitle,
	series,
	subtitleJob
} from '#lib/server/db/schema.ts';
import { probeDuration, speechChunks } from '#lib/server/library/ffmpeg.ts';
import { hlsDir, movieFile, movieSubsDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { transcribeVtt, voiceEnabled } from '#lib/server/voice/whisper.ts';
import {
	languageLabel,
	normalizeLang,
	whisperLanguage,
	type SubtitleTrack
} from '#lib/languages.ts';
import { parseVtt, serializeVtt, type Cue } from '#lib/vtt.ts';

/**
 * Subtitles made by Whisper (the voice commands' server) for what has none in the language of its
 * audio, asked for in one language from an episode's menu, a series' selection or a film's page,
 * and managed in Gestión → Subtítulos. One at a time, in the background, in the order of the
 * queue (`subtitle_job`, kept, so a restart goes on with it); the track in pieces of a few minutes,
 * so a voice command waits for one piece at most, not for a whole film.
 *
 * An episode's go with the rest of its subtitles (`episode.subtitles`, a .vtt in its HLS folder),
 * so the browser's player and mpv show them like any other. A film's subtitles are inside its file:
 * the made ones are .vtt files in `movieSubsDir`, which mpv adds when it plays the film. Langua
 * clips take their text from either.
 */

/** Seconds of audio per request to Whisper: a few seconds of work on the GPU. */
const CHUNK_SEC = 180;
/** The files of the made ones; a converted episode's own are `sub_N_lang.vtt`. */
const AUTO_PREFIX = 'sub_auto_';
/** Done ones kept as history, the latest; failures stay until retried or dismissed. */
const KEEP_DONE = 50;

export type SubtitleKind = 'episode' | 'film';

export type SubtitleJob =
	| { state: 'queued'; lang: string }
	| { state: 'running'; lang: string; done: number; total: number }
	| { state: 'failed'; lang: string; message: string };

let paused = false;
let wake: (() => void) | null = null;
/** The one being made: its row, how to cancel it, and pieces of audio done of the total. */
let current: {
	id: number;
	abort: AbortController;
	done: number;
	total: number;
	since: number;
} | null = null;

const itemColumn = (kind: SubtitleKind) =>
	kind === 'episode' ? subtitleJob.episodeId : subtitleJob.movieId;

/** For a series' or a film's page: how the latest request of each goes, if any is not done. */
export async function subtitleJobs(kind: SubtitleKind, ids: number[]) {
	const jobs = new Map<number, SubtitleJob>();
	if (!ids.length) return jobs;
	const column = itemColumn(kind);
	const rows = await db
		.select({
			id: subtitleJob.id,
			item: column,
			state: subtitleJob.state,
			lang: subtitleJob.lang,
			error: subtitleJob.error
		})
		.from(subtitleJob)
		.where(and(inArray(column, ids), notInArray(subtitleJob.state, ['done'])))
		.orderBy(asc(subtitleJob.id));
	for (const row of rows) {
		if (row.item === null) continue;
		// A request waiting or being made says more than an old failure.
		const before = jobs.get(row.item);
		if (before && before.state !== 'failed' && row.state === 'failed') continue;
		const live = current?.id === row.id ? current : null;
		jobs.set(
			row.item,
			row.state === 'running'
				? { state: 'running', lang: row.lang, done: live?.done ?? 0, total: live?.total ?? 0 }
				: row.state === 'queued'
					? { state: 'queued', lang: row.lang }
					: { state: 'failed', lang: row.lang, message: row.error ?? 'Error' }
		);
	}
	return jobs;
}

const isAuto = (track: { file?: string }) => Boolean(track.file?.startsWith(AUTO_PREFIX));

/**
 * The languages of the audio tracks with no subtitles of their own in them, each with its track
 * (by order: `a0`, `a1`… of an episode's HLS, or of a film's file; the first of a language). Made
 * ones do not count, so asking again remakes them. A film may have eight tracks: one is chosen.
 */
export function tracksWithoutSubtitles(item: {
	audioTracks: { lang: string }[];
	subtitles: { lang: string; file?: string }[];
}) {
	const own = new Set(item.subtitles.filter((s) => !isAuto(s)).map((s) => normalizeLang(s.lang)));
	const tracks = new Map<string, number>();
	item.audioTracks.forEach((t, index) => {
		const lang = normalizeLang(t.lang);
		if (!own.has(lang) && !tracks.has(lang)) tracks.set(lang, index);
	});
	return [...tracks].map(([lang, index]) => ({ index, lang, label: languageLabel(lang) }));
}

/** A film's made subtitles, as files in `movieSubsDir`. */
export async function filmAutoSubtitles(movieId: number): Promise<SubtitleTrack[]> {
	const files = await readdir(movieSubsDir(movieId)).catch(() => [] as string[]);
	return files
		.filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith('.vtt'))
		.sort()
		.map((file) => {
			const lang = file.slice(AUTO_PREFIX.length, -'.vtt'.length);
			return { lang, label: autoLabel(lang), file };
		});
}

const autoLabel = (lang: string) => `${languageLabel(lang)} (automático)`;

/**
 * Into the queue, at its end; nothing if one for it is waiting or being made. `lang`: one of
 * `tracksWithoutSubtitles`. Its earlier failures go: this is their retry. Whether it went in.
 */
export async function requestSubtitles(kind: SubtitleKind, id: number, lang: string) {
	const column = itemColumn(kind);
	const added = await db.transaction(async (tx) => {
		const [busy] = await tx
			.select({ id: subtitleJob.id })
			.from(subtitleJob)
			.where(and(eq(column, id), inArray(subtitleJob.state, ['queued', 'running'])));
		if (busy) return false;
		await tx.delete(subtitleJob).where(and(eq(column, id), eq(subtitleJob.state, 'failed')));
		const [last] = await tx.select({ position: max(subtitleJob.position) }).from(subtitleJob);
		await tx.insert(subtitleJob).values({
			...(kind === 'episode' ? { episodeId: id } : { movieId: id }),
			lang: normalizeLang(lang),
			position: (last?.position ?? 0) + 1
		});
		return true;
	});
	if (added) wake?.();
	return added;
}

/** Takes these out of the queue, if they are waiting; how many were. The one being made goes on. */
export async function cancelSubtitles(kind: SubtitleKind, ids: number[]) {
	if (!ids.length) return 0;
	const removed = await db
		.delete(subtitleJob)
		.where(and(inArray(itemColumn(kind), ids), eq(subtitleJob.state, 'queued')))
		.returning({ id: subtitleJob.id });
	return removed.length;
}

/** Gestión: one out of the queue; the one being made, stopped (what it had made is lost). */
export async function cancelJob(jobId: number) {
	if (current?.id === jobId) current.abort.abort();
	else
		await db
			.delete(subtitleJob)
			.where(and(eq(subtitleJob.id, jobId), eq(subtitleJob.state, 'queued')));
}

/** Gestión: every one waiting; the one being made goes on. */
export async function cancelAllQueued() {
	await db.delete(subtitleJob).where(eq(subtitleJob.state, 'queued'));
}

/** Gestión: next, after the one being made. */
export async function moveJobFirst(jobId: number) {
	const [first] = await db
		.select({ position: min(subtitleJob.position) })
		.from(subtitleJob)
		.where(eq(subtitleJob.state, 'queued'));
	await db
		.update(subtitleJob)
		.set({ position: (first?.position ?? 1) - 1 })
		.where(and(eq(subtitleJob.id, jobId), eq(subtitleJob.state, 'queued')));
}

/** Gestión: a failed one, back to the end of the queue. */
export async function retryJob(jobId: number) {
	const [last] = await db.select({ position: max(subtitleJob.position) }).from(subtitleJob);
	await db
		.update(subtitleJob)
		.set({ state: 'queued', error: null, position: (last?.position ?? 0) + 1 })
		.where(and(eq(subtitleJob.id, jobId), eq(subtitleJob.state, 'failed')));
	wake?.();
}

/** Gestión: a failure out of sight. */
export async function dismissJob(jobId: number) {
	await db
		.delete(subtitleJob)
		.where(and(eq(subtitleJob.id, jobId), eq(subtitleJob.state, 'failed')));
}

/** Paused, nothing new starts; the one being made finishes. */
export async function pauseSubtitles() {
	paused = true;
	await setSubtitlesPaused(true);
}

export async function resumeSubtitles() {
	paused = false;
	await setSubtitlesPaused(false);
	wake?.();
}

/** Gestión → Subtítulos: the queue in order, the one being made, failures and the last done. */
export async function subtitleQueue() {
	const rows = await db
		.select({
			id: subtitleJob.id,
			state: subtitleJob.state,
			lang: subtitleJob.lang,
			error: subtitleJob.error,
			cues: subtitleJob.cues,
			episodeId: subtitleJob.episodeId,
			movieId: subtitleJob.movieId,
			seriesId: series.id,
			seriesTitle: series.title,
			season: episode.season,
			number: episode.number,
			episodeTitle,
			movieTitle,
			finishedAt: subtitleJob.finishedAt
		})
		.from(subtitleJob)
		.leftJoin(episode, eq(episode.id, subtitleJob.episodeId))
		.leftJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(movie, eq(movie.id, subtitleJob.movieId))
		.orderBy(asc(subtitleJob.position), asc(subtitleJob.id));
	const items = rows.map((r) => ({
		id: r.id,
		state: r.state,
		language: languageLabel(r.lang),
		error: r.error,
		cues: r.cues,
		finishedAt: r.finishedAt,
		...(r.episodeId !== null
			? {
					title: `${r.seriesTitle} · T${r.season} E${r.number}`,
					detail: r.episodeTitle ?? '',
					href: `/series/${r.seriesId}`
				}
			: { title: r.movieTitle ?? '', detail: 'Película', href: `/cine/${r.movieId}` })
	}));
	const running = items.find((i) => i.state === 'running');
	const live = running && current?.id === running.id ? current : null;
	return {
		available: voiceEnabled,
		paused,
		running: running
			? {
					...running,
					done: live?.done ?? 0,
					total: live?.total ?? 0,
					elapsedSec: live ? Math.round((Date.now() - live.since) / 1000) : 0
				}
			: null,
		queued: items.filter((i) => i.state === 'queued'),
		failed: items.filter((i) => i.state === 'failed'),
		done: items
			.filter((i) => i.state === 'done')
			.sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
	};
}

/**
 * From the server's start: what a previous run left half made goes back to the queue, the pause
 * is as it was, and the queue goes on.
 */
export async function startSubtitles() {
	if (!voiceEnabled) return;
	paused = await subtitlesPaused();
	await db
		.update(subtitleJob)
		.set({ state: 'queued', startedAt: null })
		.where(eq(subtitleJob.state, 'running'));
	void (async () => {
		while (true) {
			try {
				if (!paused && (await makeNext())) continue;
			} catch (error) {
				log.error('subtitulos', 'Fallo inesperado de la cola de subtítulos', { error });
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 60_000);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			wake = null;
		}
	})();
}

/** The first of the queue, made; false if there was none. */
async function makeNext() {
	const [job] = await db
		.select()
		.from(subtitleJob)
		.where(eq(subtitleJob.state, 'queued'))
		.orderBy(asc(subtitleJob.position), asc(subtitleJob.id))
		.limit(1);
	if (!job) return false;
	await db
		.update(subtitleJob)
		.set({ state: 'running', startedAt: new Date() })
		.where(eq(subtitleJob.id, job.id));
	const run = { id: job.id, abort: new AbortController(), done: 0, total: 0, since: Date.now() };
	current = run;
	try {
		const cues =
			job.episodeId !== null
				? await episodeSubtitles(job.episodeId, job.lang, run)
				: await filmSubtitles(job.movieId!, job.lang, run);
		await db
			.update(subtitleJob)
			.set({ state: 'done', cues, finishedAt: new Date() })
			.where(eq(subtitleJob.id, job.id));
		await pruneDone();
	} catch (error) {
		if (run.abort.signal.aborted) {
			await db.delete(subtitleJob).where(eq(subtitleJob.id, job.id));
			log.info('subtitulos', 'Subtítulos cancelados a medias', { jobId: job.id });
		} else {
			const message = error instanceof Error ? error.message : String(error);
			await db
				.update(subtitleJob)
				.set({ state: 'failed', error: message, finishedAt: new Date() })
				.where(eq(subtitleJob.id, job.id));
			log.error('subtitulos', 'No se pudieron hacer los subtítulos', { jobId: job.id, error });
		}
	} finally {
		current = null;
	}
	return true;
}

async function pruneDone() {
	const keep = db
		.select({ id: subtitleJob.id })
		.from(subtitleJob)
		.where(and(eq(subtitleJob.state, 'done'), isNotNull(subtitleJob.finishedAt)))
		.orderBy(desc(subtitleJob.finishedAt))
		.limit(KEEP_DONE);
	await db
		.delete(subtitleJob)
		.where(and(eq(subtitleJob.state, 'done'), sql`${subtitleJob.id} not in (${keep})`));
}

/** Whisper marks noise and music between brackets, parentheses or notes: not words to read. */
const spoken = (text: string) =>
	text
		.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

type Run = { done: number; total: number; abort: AbortController };

/** A track's speech as cues, timed from the start. `audio`: its order among the file's tracks. */
async function transcribeTrack(input: string, audio: number, lang: string, run: Run) {
	const signal = run.abort.signal;
	const dir = await mkdtemp(path.join(tmpdir(), 'subtitulos-'));
	try {
		const chunks = await speechChunks(input, dir, { chunkSec: CHUNK_SEC, audio, signal });
		run.total = chunks.length;
		const cues: Cue[] = [];
		let offset = 0;
		for (const chunk of chunks) {
			const vtt = await transcribeVtt(chunk, whisperLanguage(lang), signal);
			for (const cue of parseVtt(vtt)) {
				const text = spoken(cue.text);
				if (text) cues.push({ start: cue.start + offset, end: cue.end + offset, text });
			}
			// The real length of the piece: the last one is shorter, and a cut is never exact.
			offset += (await probeDuration(chunk)) ?? CHUNK_SEC;
			run.done++;
			await rm(chunk, { force: true });
		}
		return cues;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** `lang`, made and written into `dir` as a .vtt: the track it is, and how many phrases. */
async function make(
	what: string,
	tracks: { index: number; lang: string }[],
	input: (track: { index: number }) => { file: string; audio: number },
	dir: string,
	lang: string,
	run: Run
) {
	const track = tracks.find((t) => t.lang === lang);
	if (!track) throw new Error('No tiene audio sin subtítulos en ese idioma');
	const started = performance.now();
	const source = input(track);
	const cues = await transcribeTrack(source.file, source.audio, track.lang, run);
	if (!cues.length) throw new Error('Whisper no oyó nada que se pudiera subtitular');
	const file = `${AUTO_PREFIX}${track.lang}.vtt`;
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, file), serializeVtt(cues));
	log.info(
		'subtitulos',
		`Subtítulos automáticos de ${what} (${track.lang}): ${cues.length} frases`,
		{
			ms: Math.round(performance.now() - started)
		}
	);
	return { track: { lang: track.lang, label: autoLabel(track.lang), file }, cues: cues.length };
}

async function episodeSubtitles(episodeId: number, lang: string, run: Run) {
	const [ep] = await db
		.select({
			status: episode.status,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles
		})
		.from(episode)
		.where(eq(episode.id, episodeId));
	if (!ep || ep.status !== 'ready') throw new Error('El capítulo no está convertido');
	const made = await make(
		`el capítulo ${episodeId}`,
		tracksWithoutSubtitles(ep),
		// One HLS rendition per audio track, with only its own.
		(track) => ({ file: path.join(hlsDir(episodeId), `a${track.index}`, 'index.m3u8'), audio: 0 }),
		hlsDir(episodeId),
		lang,
		run
	);

	// Read again: the list may have changed meanwhile. It replaces one of an earlier try.
	const [now] = await db
		.select({ subtitles: episode.subtitles })
		.from(episode)
		.where(eq(episode.id, episodeId));
	await db
		.update(episode)
		.set({
			subtitles: [...(now?.subtitles ?? []).filter((s) => s.file !== made.track.file), made.track]
		})
		.where(eq(episode.id, episodeId));
	return made.cues;
}

async function filmSubtitles(movieId: number, lang: string, run: Run) {
	const [film] = await db
		.select({
			status: movie.status,
			path: movie.path,
			audioTracks: movie.audioTracks,
			subtitles: movie.subtitles
		})
		.from(movie)
		.where(eq(movie.id, movieId));
	if (!film || film.status !== 'ready') throw new Error('La película no está catalogada');
	const made = await make(
		`la película ${movieId}`,
		tracksWithoutSubtitles(film),
		(track) => ({ file: movieFile(film.path), audio: track.index }),
		movieSubsDir(movieId),
		lang,
		run
	);
	return made.cues;
}
