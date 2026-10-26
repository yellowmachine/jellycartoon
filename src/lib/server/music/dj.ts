import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openRouterConfig, voiceModel } from '#lib/server/app-settings.ts';
import { probeDuration, toOpus } from '#lib/server/library/ffmpeg.ts';
import { djDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { piper, piperEnabled } from '#lib/server/piper.ts';
import { completeJson, speech } from '#lib/server/openrouter.ts';
import { getAlbums, tracksById } from './albums.ts';
import {
	insertNextOnSnapcast,
	nextOnSnapcast,
	onSnapcastTrack,
	queuedOnSnapcast,
	queueOnSnapcast,
	setSnapcastDj,
	snapcastRemaining
} from './snapcast.ts';
import { fold, type DjOptions, type DjVoice, type MusicTrack } from '#lib/music.ts';

/**
 * Modo DJ (#117): songs at random from the library (or from some artists), and every few of them
 * a DJ who says what has sounded and what comes, as on the radio. Its words are written by the AI
 * (OpenRouter) with only what the files say, so that it does not make things up, read aloud by
 * Gemini through OpenRouter (or by Piper, PIPER_URL, without a key or if it fails), and go into the
 * queue as one more track: so they sound the same in the browser and on Snapcast. They are made while the song before them plays: never a silence
 * waiting for them; if they are not ready in time, that talk is skipped.
 */

/** With a voice: OpenRouter's, or Piper's. */
export async function djEnabled() {
	return piperEnabled || Boolean((await openRouterConfig()).apiKey);
}

/**
 * The DJ's voice through OpenRouter: chosen by ear on 2026-10-25 among ElevenLabs, Fish and
 * Gemini's; it says English names and titles well inside Spanish, which Piper does not.
 */
const SPEECH_MODEL = 'google/gemini-3.8-flash-tts';
const VOICES: Record<DjVoice, string> = { male: 'Puck', female: 'Laomedeia' };

/** How it speaks: told apart from the words, which Gemini would otherwise read aloud. */
function delivery(lang: DjOptions['lang'], voice: DjVoice) {
	if (lang === 'en')
		return 'Upbeat, friendly music radio DJ. Clear and not too fast: the listener is learning English.';
	return [
		voice === 'female' ? 'Locutora' : 'Locutor',
		'de radio musical de España, acento castellano peninsular, tono animado y cercano.',
		'Pronuncia los nombres de grupos y los títulos de canciones en su idioma original, con naturalidad.'
	].join(' ');
}

/** Songs asked for at a time; more when only a few are left. */
export const DJ_BATCH = 30;
/** Fewer than this after the one on, and more are added. */
export const DJ_REFILL_BELOW = 3;
/** Quite enough for the words of a talk, by OpenRouter or Piper. */
const PIPER_TIMEOUT_MS = 60_000;
/** The DJ's words are kept this long: the queue may be saved and brought back meanwhile. */
const KEEP_MS = 12 * 3600_000;

/**
 * `count` songs at random, of `artists` (none: all), not those in `exclude`; when every one of them
 * has sounded already, any of them again.
 */
export async function randomTracks(artists: string[], count: number, exclude: number[] = []) {
	const wanted = new Set(artists.map(fold));
	const skip = new Set(exclude);
	const all = (await getAlbums())
		.filter((a) => !wanted.size || wanted.has(fold(a.artist)))
		.flatMap((a) => a.tracks);
	const fresh = all.filter((t) => !skip.has(t.id));
	const tracks = fresh.length ? fresh : all;
	// Fisher–Yates.
	for (let i = tracks.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
	}
	return tracks.slice(0, count);
}

const describe = (t: MusicTrack) => `«${t.title}», de ${t.artist} (álbum «${t.album}»)`;

/**
 * What the DJ says after `played` (the songs since it last spoke), before `next`. Only with what
 * the files say: the AI is told not to add anything, which is its main risk. Without a key, or if
 * the AI fails, the same said plainly.
 */
async function words(played: MusicTrack[], next: MusicTrack | null, lang: DjOptions['lang']) {
	const english = lang === 'en';
	const facts = [
		`Han sonado: ${played.map(describe).join('; ')}.`,
		next ? `Ahora suena: ${describe(next)}.` : 'No se sabe qué suena después.'
	].join('\n');
	const { apiKey } = await openRouterConfig();
	if (apiKey) {
		try {
			const { texto } = await completeJson<{ texto: string }>({
				system: [
					'Eres el locutor de una emisora de radio musical que suena en una casa.',
					'Entre canción y canción dices en voz alta, en una a tres frases (unos 15 segundos),',
					'qué ha sonado y qué viene ahora, con naturalidad y simpatía, como en la radio.',
					'Usa SOLO los datos que te dan: no inventes años, historias, géneros ni nada que no esté.',
					'Sin emojis ni acotaciones: es texto para leer en voz alta.',
					english
						? 'Habla en inglés (English), sencillo y claro: quien escucha está aprendiendo.'
						: 'Habla en español de España.'
				].join(' '),
				prompt: facts,
				name: 'locucion',
				label: 'Locutor del modo DJ',
				schema: {
					type: 'object',
					properties: { texto: { type: 'string' } },
					required: ['texto'],
					additionalProperties: false
				},
				model: await voiceModel(),
				maxTokens: 1000,
				timeoutMs: 30_000
			});
			if (texto.trim()) return texto.trim();
		} catch (error) {
			log.warn('música', 'El locutor del modo DJ no pudo escribir; lo dice sin IA', { error });
		}
	}
	const last = played.at(-1);
	if (english)
		return [
			last ? `That was ${last.title}, by ${last.artist}.` : '',
			next ? `Now, ${next.title}, by ${next.artist}.` : ''
		].join(' ');
	return [
		last ? `Acabas de escuchar ${last.title}, de ${last.artist}.` : '',
		next ? `Ahora, ${next.title}, de ${next.artist}.` : ''
	].join(' ');
}

/** 16-bit mono PCM as a WAV file, for ffmpeg. */
function wavOf(pcm: Uint8Array, rate: number) {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

/**
 * `text` read aloud, as a WAV: by Gemini through OpenRouter, or by Piper without a key or if it
 * fails (and there is Piper). Which one, for the Registro.
 */
async function voiced(text: string, lang: DjOptions['lang'], voice: DjVoice) {
	const { apiKey } = await openRouterConfig();
	if (apiKey) {
		try {
			const { pcm, rate } = await speech({
				model: SPEECH_MODEL,
				voice: VOICES[voice],
				input: text,
				instructions: delivery(lang, voice),
				timeoutMs: PIPER_TIMEOUT_MS
			});
			return { wav: wavOf(pcm, rate), by: `${SPEECH_MODEL} (${VOICES[voice]})` };
		} catch (error) {
			if (!piperEnabled) throw error;
			log.warn('música', 'La voz de OpenRouter falló; lo dice Piper', { error });
		}
	}
	return { wav: await piper(text, lang), by: 'Piper' };
}

/** `text` read aloud, as an Opus file in `djDir`: its id, how long it lasts and who said it. */
async function speak(text: string, lang: DjOptions['lang'], voice: DjVoice) {
	const { wav: audio, by } = await voiced(text, lang, voice);
	await mkdir(djDir, { recursive: true });
	await prune();
	const id = randomUUID();
	const wav = path.join(djDir, `${id}.wav`);
	try {
		await writeFile(wav, audio);
		// Speech: a fraction of a song's bitrate, for the phone's data in the car too.
		await toOpus(wav, clipFile(id), '48k');
	} finally {
		await rm(wav, { force: true });
	}
	return { id, durationSec: await probeDuration(clipFile(id)), by };
}

/** Where the DJ's words with this id are. */
export const clipFile = (id: string) => path.join(djDir, `${id}.opus`);

/** One made by `speak`: nothing else is served from `djDir`. */
export const isClipId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

/** The old ones go. */
async function prune() {
	const now = Date.now();
	for (const file of await readdir(djDir).catch(() => [] as string[])) {
		const at = (await stat(path.join(djDir, file)).catch(() => null))?.mtimeMs ?? now;
		if (now - at > KEEP_MS) await rm(path.join(djDir, file), { force: true });
	}
}

/**
 * Negative, so the DJ's words never clash with a song's id in the queue; from a random start, so
 * not with those of before a restart either.
 */
let clipCount = Math.floor(Math.random() * 1_000_000);

/** The DJ's words after `played`, before `next`, as a track of the queue. */
export async function makeClip(
	played: MusicTrack[],
	next: MusicTrack | null,
	lang: DjOptions['lang'],
	voice: DjVoice
): Promise<MusicTrack> {
	const started = performance.now();
	const text = await words(played, next, lang);
	const { id, durationSec, by } = await speak(text, lang, voice);
	log.info('música', `Locutor del modo DJ: «${text}»`, {
		lang,
		voice: by,
		ms: Math.round(performance.now() - started)
	});
	return {
		id: -++clipCount,
		title: lang === 'en' ? 'The DJ' : 'El locutor',
		artist: text,
		number: null,
		durationSec,
		albumId: 0,
		album: 'Modo DJ',
		hasCover: false,
		clip: { id, text }
	};
}

/**
 * Modo DJ on Snapcast: the same as in the browser (dj.svelte.ts), here, as the queue is mpv's.
 * Followed with the track each entry is: more songs when few are left, and the DJ's words after
 * the one on when it is time.
 */
const snap = {
	options: null as DjOptions | null,
	/** Songs since the DJ last spoke. */
	played: [] as MusicTrack[],
	/** The last entry seen: start-file can be told twice. */
	entryId: -1,
	busy: false
};

export async function startDjOnSnapcast(options: DjOptions) {
	const tracks = await tracksById((await randomTracks(options.artists, DJ_BATCH)).map((t) => t.id));
	if (!tracks.length) throw new Error('No hay canciones de esos artistas');
	// On before the queue: its first song counts too.
	Object.assign(snap, { options, played: [], entryId: -1 });
	setSnapcastDj(true);
	try {
		await queueOnSnapcast(tracks, { replace: true });
	} catch (error) {
		stopDjOnSnapcast();
		throw error;
	}
	log.info('música', 'Modo DJ en Snapcast', { ...options });
}

/** Something else was put on Snapcast, or it was stopped. */
export function stopDjOnSnapcast() {
	if (!snap.options) return;
	snap.options = null;
	snap.played = [];
	setSnapcastDj(false);
}

onSnapcastTrack((entryId, track) => {
	if (!snap.options || entryId === snap.entryId) return;
	snap.entryId = entryId;
	if (!track.clip) snap.played.push(track);
	void stepSnapcast(entryId, track);
});

async function stepSnapcast(entryId: number, track: MusicTrack) {
	const options = snap.options;
	if (!options || snap.busy) return;
	snap.busy = true;
	try {
		if ((await snapcastRemaining()) < DJ_REFILL_BELOW) {
			const more = await tracksById(
				(await randomTracks(options.artists, DJ_BATCH, queuedOnSnapcast())).map((t) => t.id)
			);
			if (snap.options === options) await queueOnSnapcast(more, { replace: false });
		}
		if (track.clip || snap.played.length < options.every) return;
		const played = snap.played;
		const clip = await makeClip(played, await nextOnSnapcast(), options.lang, options.voice);
		// Still on that song and in the same DJ mode: after it, and the count starts again.
		if (snap.options !== options || snap.entryId !== entryId) return;
		await insertNextOnSnapcast(clip, clipFile(clip.clip!.id));
		snap.played = [];
	} catch (error) {
		log.error('música', 'El modo DJ en Snapcast falló', { error });
	} finally {
		snap.busy = false;
	}
}
