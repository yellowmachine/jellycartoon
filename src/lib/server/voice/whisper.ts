import { WHISPER_SUBTITLES_URL, WHISPER_URL } from '$app/env/private';
import { getAlbums } from '#lib/server/music/albums.ts';
import { cleanTranscript, whisperPrompt } from './transcript.ts';
import { phrasesFromWhisper, type WhisperVerbose } from './whisper-cues.ts';

/**
 * Speech to text for voice commands (#33), with whisper.cpp's server (whisper-server):
 * https://github.com/ggml-org/whisper.cpp/tree/master/examples/server. Its language is set when it
 * starts (`-l es`), and with `--convert` it takes what the browser records (WebM/Opus, MP4/AAC).
 */

export const voiceEnabled = Boolean(WHISPER_URL);

/**
 * The automatic subtitles' server: a second one if there is (WHISPER_SUBTITLES_URL), so a voice
 * command does not wait for a piece of a film to be done; a server takes one request at a time.
 */
const SUBTITLES_URL = WHISPER_SUBTITLES_URL ?? WHISPER_URL;

/** Whisper keeps the last 224 tokens of a prompt: about this much Spanish and names. */
const HINT_CHARS = 600;
/** The library changes seldom: asked again after this long. */
const HINT_MS = 10 * 60_000;
/** The compilations' artist is not a name anyone says. */
const NOT_SAID = new Set(['varios artistas', 'various artists']);
let hint: { text: string; at: number } | null = null;

/**
 * The library's artists, those with most songs first, as words Whisper should expect
 * (whisper.cpp's `prompt`): «Franco Battiato» or «The Notorious B.I.G.» written as they are.
 * Tried on 2026-10-27 with nine orders of the satellite: the rest came out the same. Song titles
 * do not fit (thousands), so a title heard wrong is found by how it sounds (music-search.ts).
 */
async function libraryHint() {
	if (hint && Date.now() - hint.at < HINT_MS) return hint.text;
	const songs = new Map<string, number>();
	for (const a of await getAlbums())
		if (!NOT_SAID.has(a.artist.toLowerCase()))
			songs.set(a.artist, (songs.get(a.artist) ?? 0) + a.tracks.length);
	let text = 'Órdenes de voz para la casa: pon música de ';
	for (const [artist] of [...songs].sort((a, b) => b[1] - a[1])) {
		if (text.length + artist.length > HINT_CHARS) break;
		text += `${artist}, `;
	}
	hint = { text: songs.size ? `${text.replace(/, $/, '')}.` : '', at: Date.now() };
	return hint.text;
}

/** What was said in `audio`; empty if nothing was. `familyWords`: names to write as they are. */
export async function transcribe(audio: Blob, familyWords = '') {
	const form = new FormData();
	form.append('file', audio, 'voz');
	form.append('response_format', 'json');
	// The most likely words, not a sampled guess: an order, not prose.
	form.append('temperature', '0');
	const prompt = whisperPrompt(await libraryHint().catch(() => ''), familyWords, HINT_CHARS);
	if (prompt) form.append('prompt', prompt);
	const res = await fetch(`${WHISPER_URL}/inference`, {
		method: 'POST',
		body: form,
		signal: AbortSignal.timeout(30_000)
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Whisper: ${err instanceof Error ? err.message : err}`);
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || typeof body?.text !== 'string')
		throw new Error(`Whisper: ${body?.error ?? res.statusText}`);
	return cleanTranscript(body.text);
}

/**
 * The phrases said in a stretch of speech (a WAV file), timed from its start: each from its first
 * word when the server times words (`-dtw`, see `phrasesFromWhisper`). `language`: the ISO 639-1 code
 * (see `whisperLanguage`), instead of the one the server started with, or `auto`.
 */
export async function transcribeCues(file: string, language: string, signal?: AbortSignal) {
	const form = new FormData();
	form.append('file', Bun.file(file), 'trozo.wav');
	form.append('language', language);
	form.append('response_format', 'verbose_json');
	form.append('temperature', '0');
	const res = await fetch(`${SUBTITLES_URL}/inference`, {
		method: 'POST',
		body: form,
		// A whole episode at once: a few tens of seconds on a GPU, more on a slow one.
		signal: AbortSignal.any([AbortSignal.timeout(600_000), ...(signal ? [signal] : [])])
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Whisper: ${err instanceof Error ? err.message : err}`);
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Whisper: ${text.slice(0, 200) || res.statusText}`);
	const body = JSON.parse(text) as WhisperVerbose;
	if (!Array.isArray(body?.segments)) throw new Error('Whisper: respuesta sin frases');
	return phrasesFromWhisper(body);
}
