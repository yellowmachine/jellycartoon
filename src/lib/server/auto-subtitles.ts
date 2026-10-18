import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, movie } from '#lib/server/db/schema.ts';
import { probeDuration, speechChunks } from '#lib/server/library/ffmpeg.ts';
import { hlsDir, movieFile, movieSubsDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { transcribeVtt } from '#lib/server/voice/whisper.ts';
import {
	languageLabel,
	normalizeLang,
	whisperLanguage,
	type SubtitleTrack
} from '#lib/languages.ts';
import { parseVtt, serializeVtt, type Cue } from '#lib/vtt.ts';

/**
 * Subtitles made by Whisper (the voice commands' server) for what has none in the language of its
 * audio, asked for in one language from an episode's menu or a film's page. One at a time, in the
 * background; the track in pieces of a few minutes, so a voice command waits for one piece at
 * most, not for a whole film.
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

export type SubtitleKind = 'episode' | 'film';
type Key = `${SubtitleKind}:${number}`;

/** Waiting their turn, in order; one per episode or film, in the language asked for. */
const queue: { key: Key; lang: string }[] = [];
/** The one being made: pieces of audio done, of the total known once it is cut. */
let running: { key: Key; lang: string; done: number; total: number } | null = null;
/** Why the last attempt failed, until it is asked for again. */
const failures = new Map<Key, { lang: string; message: string }>();

export type SubtitleJob =
	| { state: 'queued'; lang: string }
	| { state: 'running'; lang: string; done: number; total: number }
	| { state: 'failed'; lang: string; message: string };

export function subtitleJob(kind: SubtitleKind, id: number): SubtitleJob | null {
	const key: Key = `${kind}:${id}`;
	if (running?.key === key) {
		const { lang, done, total } = running;
		return { state: 'running', lang, done, total };
	}
	const queued = queue.find((q) => q.key === key);
	if (queued) return { state: 'queued', lang: queued.lang };
	const failed = failures.get(key);
	return failed ? { state: 'failed', ...failed } : null;
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

/** `lang`: one of `tracksWithoutSubtitles`; while one is made or waits, others are not taken. */
export function requestSubtitles(kind: SubtitleKind, id: number, lang: string) {
	const key: Key = `${kind}:${id}`;
	if (running?.key === key || queue.some((q) => q.key === key)) return;
	failures.delete(key);
	queue.push({ key, lang: normalizeLang(lang) });
	if (!running) void work();
}

/**
 * Takes these out of the queue, if they are waiting; how many were. The one being made goes on:
 * Whisper is halfway through it.
 */
export function cancelSubtitles(kind: SubtitleKind, ids: number[]) {
	const keys = new Set(ids.map((id): Key => `${kind}:${id}`));
	let cancelled = 0;
	for (let i = queue.length - 1; i >= 0; i--) {
		if (!keys.has(queue[i]!.key)) continue;
		queue.splice(i, 1);
		cancelled++;
	}
	return cancelled;
}

async function work() {
	for (let next = queue.shift(); next; next = queue.shift()) {
		const job = { ...next, done: 0, total: 0 };
		running = job;
		const [kind, id] = next.key.split(':') as [SubtitleKind, string];
		try {
			await (kind === 'episode' ? episodeSubtitles : filmSubtitles)(Number(id), job);
		} catch (error) {
			failures.set(next.key, {
				lang: next.lang,
				message: error instanceof Error ? error.message : String(error)
			});
			log.error('subtitulos', 'No se pudieron hacer los subtítulos', { kind, id, error });
		}
	}
	running = null;
}

/** Whisper marks noise and music between brackets, parentheses or notes: not words to read. */
const spoken = (text: string) =>
	text
		.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

type Progress = { done: number; total: number };

/** A track's speech as cues, timed from the start. `audio`: its order among the file's tracks. */
async function transcribeTrack(input: string, audio: number, lang: string, progress: Progress) {
	const dir = await mkdtemp(path.join(tmpdir(), 'subtitulos-'));
	try {
		const chunks = await speechChunks(input, dir, { chunkSec: CHUNK_SEC, audio });
		progress.total += chunks.length;
		const cues: Cue[] = [];
		let offset = 0;
		for (const chunk of chunks) {
			const vtt = await transcribeVtt(chunk, whisperLanguage(lang));
			for (const cue of parseVtt(vtt)) {
				const text = spoken(cue.text);
				if (text) cues.push({ start: cue.start + offset, end: cue.end + offset, text });
			}
			// The real length of the piece: the last one is shorter, and a cut is never exact.
			offset += (await probeDuration(chunk)) ?? CHUNK_SEC;
			progress.done++;
			await rm(chunk, { force: true });
		}
		return cues;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** The job's language, made and written into `dir` as a .vtt; the track it is. */
async function make(
	what: string,
	tracks: { index: number; lang: string }[],
	input: (track: { index: number }) => { file: string; audio: number },
	dir: string,
	job: Progress & { lang: string }
): Promise<SubtitleTrack> {
	const track = tracks.find((t) => t.lang === job.lang);
	if (!track) throw new Error('No tiene audio sin subtítulos en ese idioma');
	const started = performance.now();
	const source = input(track);
	const cues = await transcribeTrack(source.file, source.audio, track.lang, job);
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
	return { lang: track.lang, label: autoLabel(track.lang), file };
}

async function episodeSubtitles(episodeId: number, job: Progress & { lang: string }) {
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
		job
	);

	// Read again: the list may have changed meanwhile. It replaces one of an earlier try.
	const [now] = await db
		.select({ subtitles: episode.subtitles })
		.from(episode)
		.where(eq(episode.id, episodeId));
	await db
		.update(episode)
		.set({ subtitles: [...(now?.subtitles ?? []).filter((s) => s.file !== made.file), made] })
		.where(eq(episode.id, episodeId));
}

async function filmSubtitles(movieId: number, job: Progress & { lang: string }) {
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
	await make(
		`la película ${movieId}`,
		tracksWithoutSubtitles(film),
		(track) => ({ file: movieFile(film.path), audio: track.index }),
		movieSubsDir(movieId),
		job
	);
}
