import { WHISPER_URL } from '$app/env/private';
import { cleanTranscript } from './transcript.ts';

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
