import { WHISPER_URL } from '$app/env/private';
import { cleanTranscript } from './transcript.ts';
import { cuesFromWhisper, type WhisperVerbose } from './whisper-cues.ts';

/**
 * Speech to text for voice commands (#33), with whisper.cpp's server (whisper-server):
 * https://github.com/ggml-org/whisper.cpp/tree/master/examples/server. Its language is set when it
 * starts (`-l es`), and with `--convert` it takes what the browser records (WebM/Opus, MP4/AAC).
 */

export const voiceEnabled = Boolean(WHISPER_URL);

/** What was said in `audio`; empty if nothing was. */
export async function transcribe(audio: Blob) {
	const form = new FormData();
	form.append('file', audio, 'voz');
	form.append('response_format', 'json');
	// The most likely words, not a sampled guess: an order, not prose.
	form.append('temperature', '0');
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
 * Subtitles for a stretch of speech (a WAV file), timed from its start: each phrase from its first
 * word when the server times words (`-dtw`, see `cuesFromWhisper`). `language`: the ISO 639-1 code
 * (see `whisperLanguage`), instead of the one the server started with, or `auto`.
 */
export async function transcribeCues(file: string, language: string, signal?: AbortSignal) {
	const form = new FormData();
	form.append('file', Bun.file(file), 'trozo.wav');
	form.append('language', language);
	form.append('response_format', 'verbose_json');
	form.append('temperature', '0');
	const res = await fetch(`${WHISPER_URL}/inference`, {
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
	return cuesFromWhisper(body);
}
