import { PIPER_URL, PIPER_VOICE_EN, PIPER_VOICE_ES } from '$app/env/private';

/**
 * Piper's HTTP server on the PC with the app (deploy/jellycartoon-piper.service): text read aloud,
 * as a WAV. The DJ's voice without OpenRouter (music/dj.ts), and the voice satellites' answers
 * (#223, /api/voice/speak).
 */

export const piperEnabled = Boolean(PIPER_URL);

/** Quite enough for the words of a talk; Piper says them in a second or two. */
const TIMEOUT_MS = 60_000;

export async function piper(text: string, lang: 'es' | 'en' = 'es') {
	if (!PIPER_URL) throw new Error('No hay Piper (PIPER_URL)');
	const res = await fetch(`${PIPER_URL.replace(/\/+$/, '')}/synthesize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, voice: lang === 'en' ? PIPER_VOICE_EN : PIPER_VOICE_ES }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Piper: ${err instanceof Error ? err.message : err}`);
	});
	if (!res.ok) throw new Error(`Piper: ${(await res.text()).slice(0, 200) || res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}
