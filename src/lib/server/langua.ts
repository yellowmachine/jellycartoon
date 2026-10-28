import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieProgress,
	movieTitle,
	series,
	userSettings,
	watchProgress
} from '#lib/server/db/schema.ts';
import { cachedProbe, inTurn } from '#lib/server/cinema/frames.ts';
import { audioClip, subtitleClip } from '#lib/server/library/ffmpeg.ts';
import { hlsDir, movieFile, movieSubsDir } from '#lib/server/library/paths.ts';
import { filmAutoSubtitles } from '#lib/server/auto-subtitles.ts';
import { log } from '#lib/server/log.ts';
import { getSettings } from '#lib/server/settings.ts';
import { normalizeLang } from 'comun/languages.ts';
import { readCues } from '#lib/server/auto-subtitle-files.ts';
import { cuesBetween, cuesText, parseVtt, type Cue } from '#lib/vtt.ts';
import type { VideoHere } from 'comun/voice.ts';

/**
 * Langua, the user's language app (langua.scholio.review): a stretch of what they are watching,
 * its audio and what is said in it, sent to its API to study («manda los últimos 5 minutos a
 * Langua»). Each account its own: their Langua, with their token, set in Ajustes.
 *
 * The API, `POST {url}/api/v1/clips` with `Authorization: Bearer {token}`, takes multipart form
 * data: `audio` (AAC in .m4a) and `metadata` (JSON, `ClipMetadata`). `GET {url}/api/v1/ping`, with
 * the same token, says whether it is accepted.
 */

/** Longest clip: more is not a clip. */
export const MAX_CLIP_MINUTES = 10;
/** What was played longer ago than this is not «what I am watching». */
const RECENT_MS = 30 * 60_000;
/** Shorter than this, there is nothing to study. */
const MIN_CLIP_SECONDS = 5;

export interface ClipMetadata {
	source: 'jellycartoon';
	kind: 'episode' | 'film';
	title: string;
	series: string | null;
	season: number | null;
	episode: number | null;
	year: number | null;
	/** Of the clip in the episode or film, in seconds. */
	startSec: number;
	endSec: number;
	/** ISO 639-2 of the audio track, e.g. `eng`; `und` if it is not tagged. */
	language: string;
	/** What is said, from the subtitles; null without any. */
	transcript: string | null;
	transcriptLanguage: string | null;
	/** The same, timed from the start of the clip. */
	cues: Cue[];
	/** ISO 8601. */
	capturedAt: string;
}

export interface LanguaConfig {
	url: string;
	token: string;
}

export async function languaConfig(userId: string): Promise<LanguaConfig | null> {
	const [row] = await db
		.select({ url: userSettings.languaUrl, token: userSettings.languaToken })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));
	return row?.url && row.token ? { url: row.url, token: row.token } : null;
}

/** `token` undefined keeps the one there is; null for both forgets Langua. */
export async function setLanguaConfig(
	userId: string,
	values: { url: string | null; token?: string | null }
) {
	const set = {
		languaUrl: values.url,
		...(values.token !== undefined && { languaToken: values.token })
	};
	await db
		.insert(userSettings)
		.values({ userId, ...set })
		.onConflictDoUpdate({ target: userSettings.userId, set });
}

/** `https://langua.example/` as `https://langua.example`; null if it is not an http(s) address. */
export function normalizeLanguaUrl(text: string) {
	try {
		const url = new URL(text.trim());
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.href.replace(/\/+$/, '');
	} catch {
		return null;
	}
}

const headers = (config: LanguaConfig) => ({
	Authorization: `Bearer ${config.token}`,
	'User-Agent': 'JellyCartoon'
});

/** Langua's tokens (`lng_…`) are made there: what to do when one is refused. */
const TOKEN_REFUSED =
	'Langua no acepta el token: crea uno nuevo en Langua, en Mi cuenta → Integraciones, y ponlo en Ajustes.';

/**
 * Why Langua said no, to be read aloud: its own words for what it refuses (4xx, short and in
 * Spanish), a generic sentence for its own failures (5xx, whose body says nothing useful).
 */
async function refusal(res: Response) {
	if (res.status === 401 || res.status === 403) return TOKEN_REFUSED;
	if (res.status >= 500) return `Langua ha fallado (${res.status}). Prueba otra vez más tarde.`;
	const body = await res.json().catch(() => null);
	return `Langua no lo aceptó: ${body?.message ?? `${res.status} ${res.statusText}`}`;
}

/** Null if Langua accepts the token; otherwise why not, to show in Ajustes. */
export async function pingLangua(config: LanguaConfig) {
	const res = await fetch(`${config.url}/api/v1/ping`, {
		headers: headers(config),
		signal: AbortSignal.timeout(10_000)
	}).catch((err) => err as Error);
	if (res instanceof Error) return `No se pudo conectar con Langua: ${res.message}`;
	return res.ok ? null : refusal(res);
}

/** The episode or film the user played last, if it was a moment ago, and up to where. */
const episodeColumns = {
	id: episode.id,
	title: episodeTitle,
	seriesTitle: series.title,
	season: episode.season,
	number: episode.number,
	audioTracks: episode.audioTracks,
	subtitles: episode.subtitles,
	durationSec: episode.durationSec
};

/**
 * What the user is watching, and up to where: the episode the page says plays in its player, at
 * its exact second; otherwise the last one played, if it was a moment ago, up to its last save.
 */
async function nowWatching(userId: string, video: VideoHere | null) {
	if (video) {
		const [ep] = await db
			.select(episodeColumns)
			.from(episode)
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(and(eq(episode.id, video.episodeId), eq(episode.status, 'ready')));
		if (ep) return { kind: 'episode' as const, ...ep, endSec: video.positionSec };
	}
	const [[ep], [film]] = await Promise.all([
		db
			.select({
				...episodeColumns,
				positionSec: watchProgress.positionSec,
				completed: watchProgress.completed,
				at: watchProgress.updatedAt
			})
			.from(watchProgress)
			.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(and(eq(watchProgress.userId, userId), eq(episode.status, 'ready')))
			.orderBy(desc(watchProgress.updatedAt))
			.limit(1),
		db
			.select({
				id: movie.id,
				title: movieTitle,
				year: movie.year,
				path: movie.path,
				durationSec: movie.durationSec,
				positionSec: movieProgress.positionSec,
				completed: movieProgress.completed,
				at: movieProgress.updatedAt
			})
			.from(movieProgress)
			.innerJoin(movie, eq(movie.id, movieProgress.movieId))
			.where(and(eq(movieProgress.userId, userId), eq(movie.status, 'ready')))
			.orderBy(desc(movieProgress.updatedAt))
			.limit(1)
	]);
	const latest =
		ep && (!film || ep.at >= film.at)
			? { kind: 'episode' as const, ...ep }
			: film
				? { kind: 'film' as const, ...film }
				: null;
	if (!latest || Date.now() - latest.at.getTime() > RECENT_MS) return null;
	// A finished one goes back to 0 when it is saved as finished: it was watched to the end.
	const endSec =
		latest.completed && latest.positionSec <= MIN_CLIP_SECONDS
			? (latest.durationSec ?? 0)
			: latest.positionSec;
	return { ...latest, endSec };
}

const clock = (sec: number) => {
	const s = Math.floor(sec);
	const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
	return (hms[0] ? hms : hms.slice(1))
		.map((n, i) => (i ? String(n).padStart(2, '0') : n))
		.join(':');
};

/**
 * The last `minutes` of what the user is watching, sent to their Langua: in words, for the model,
 * whatever happens. `language`: the audio track (ISO 639-2), instead of the one in Ajustes.
 */
export async function sendClip(
	userId: string,
	options: { minutes: number; language?: string | null; video?: VideoHere | null }
): Promise<string> {
	const config = await languaConfig(userId);
	if (!config)
		return 'Langua no está configurado: se pone en Ajustes, con su dirección y su token.';
	const watching = await nowWatching(userId, options.video ?? null);
	if (!watching)
		return 'No está viendo ningún capítulo ni película (nada en la última media hora). La radio y los canales en directo todavía no se pueden mandar.';

	const minutes = Math.min(Math.max(options.minutes, 0.5), MAX_CLIP_MINUTES);
	const endSec = Math.floor(watching.endSec);
	const startSec = Math.max(0, endSec - Math.round(minutes * 60));
	const seconds = endSec - startSec;
	if (seconds < MIN_CLIP_SECONDS) return 'Acaba de empezar: todavía no hay nada que mandar.';

	const wanted = normalizeLang(
		options.language ?? (await getSettings(userId)).audioLang ?? AUDIO_LANG
	);
	const dir = await mkdtemp(path.join(tmpdir(), 'langua-'));
	const output = path.join(dir, 'clip.m4a');
	try {
		let language: string;
		let subtitles: { cues: Cue[]; lang: string } | null = null;
		if (watching.kind === 'episode') {
			// One HLS rendition per audio track (a0, a1…), in the order of `audioTracks`.
			const track = Math.max(
				0,
				watching.audioTracks.findIndex((t) => normalizeLang(t.lang) === wanted)
			);
			language = normalizeLang(watching.audioTracks[track]?.lang);
			const input = path.join(hlsDir(watching.id), `a${track}`, 'index.m3u8');
			if (!(await stat(input).catch(() => null)))
				return 'Este capítulo no tiene el audio aparte (se convirtió con una versión antigua).';
			await inTurn(() => audioClip(input, output, { atSec: startSec, seconds }));
			const sub =
				watching.subtitles.find((s) => normalizeLang(s.lang) === language) ?? watching.subtitles[0];
			// Whisper's as their phrases, once each, not as shown in two lines (#86).
			if (sub)
				subtitles = {
					cues: cuesBetween(await readCues(hlsDir(watching.id), sub.file), startSec, endSec),
					lang: normalizeLang(sub.lang)
				};
		} else {
			const input = movieFile(watching.path);
			const info = await cachedProbe(watching.id, input);
			// One after the other: the subtitles, in the language of the track used, which may not
			// be the one asked for. Langua only takes them as the text in that language.
			const lang = await inTurn(() =>
				audioClip(input, output, { atSec: startSec, seconds, info, audioLang: wanted })
			);
			language = lang ?? 'und';
			const sub = await inTurn(() =>
				subtitleClip(input, info, { atSec: startSec, seconds, lang: language })
			);
			// Its own in another language, or none: Whisper's in the audio's, if they were made.
			const made =
				sub?.lang === language
					? undefined
					: (await filmAutoSubtitles(watching.id)).find((s) => s.lang === language);
			const cues = made
				? await readCues(movieSubsDir(watching.id), made.file)
				: sub?.vtt
					? parseVtt(sub.vtt)
					: null;
			if (cues)
				subtitles = {
					cues: cuesBetween(cues, startSec, endSec),
					lang: made ? made.lang : sub!.lang
				};
		}

		const cues = subtitles?.cues ?? [];
		const metadata: ClipMetadata = {
			source: 'jellycartoon',
			kind: watching.kind,
			// Langua takes 1 to 300 characters.
			title: (watching.title.trim() || 'Sin título').slice(0, 300),
			series: watching.kind === 'episode' ? watching.seriesTitle : null,
			season: watching.kind === 'episode' ? watching.season : null,
			episode: watching.kind === 'episode' ? watching.number : null,
			year: watching.kind === 'film' ? watching.year : null,
			startSec,
			endSec,
			language,
			transcript: cues.length ? cuesText(cues) : null,
			transcriptLanguage: cues.length ? subtitles!.lang : null,
			cues,
			capturedAt: new Date().toISOString()
		};
		const form = new FormData();
		form.append('audio', new Blob([await readFile(output)], { type: 'audio/mp4' }), 'clip.m4a');
		form.append('metadata', JSON.stringify(metadata));
		const res = await fetch(`${config.url}/api/v1/clips`, {
			method: 'POST',
			headers: headers(config),
			body: form,
			signal: AbortSignal.timeout(60_000)
		}).catch((err) => err as Error);
		// Langua does not tell a resent clip from a new one: never sent again by itself.
		if (res instanceof Error)
			return res.name === 'TimeoutError'
				? 'Langua no ha contestado a tiempo. Puede que sí haya llegado: míralo en Langua antes de mandarlo otra vez.'
				: `No se pudo conectar con Langua: ${res.message}`;
		if (!res.ok) return refusal(res);

		const name =
			watching.kind === 'episode'
				? `«${watching.seriesTitle}» T${watching.season} E${watching.number}`
				: `«${watching.title}»`;
		log.info('langua', `Clip mandado: ${name}, ${clock(startSec)}–${clock(endSec)}`, {
			userId,
			kind: watching.kind,
			id: watching.id,
			language,
			transcript: Boolean(metadata.transcript)
		});
		// Langua takes the subtitles as the text only in the audio's language; otherwise it
		// transcribes the audio itself, and keeps them as a translation.
		const text = !metadata.transcript
			? 'sin subtítulos: Langua lo transcribirá'
			: metadata.transcriptLanguage === language && language !== 'und'
				? 'con el texto de los subtítulos'
				: `Langua lo transcribirá, y los subtítulos (en ${metadata.transcriptLanguage}) quedan como traducción`;
		return `Mandado a Langua: ${name}, de ${clock(startSec)} a ${clock(endSec)} (${seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}), audio en ${language}, ${text}.`;
	} catch (err) {
		log.error('langua', 'No se pudo hacer el clip', { userId, error: err });
		return `No se pudo hacer el clip: ${err instanceof Error ? err.message : String(err)}`;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
