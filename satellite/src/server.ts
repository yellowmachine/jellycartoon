import {
	HISTORY_IDLE_MS,
	HISTORY_TURNS,
	type VoiceReply,
	type VoiceTurn
} from '../../src/lib/voice.ts';

/**
 * The house's server, as the phone's voice talks to it (#223, phase 2): what was said, transcribed
 * there (whisper), and the order done (the AI), with the satellite's key from Ajustes → Casa. The
 * last turns go with each, as the phone's (voice-client.svelte.ts), until a while without orders.
 */

const SERVER_URL = process.env.SERVER_URL?.replace(/\/+$/, '') || null;
const KEY = process.env.SATELLITE_KEY || null;

/** With both, orders go to the server; without them, only to the log, as in phase 1. */
export const serverReady = Boolean(SERVER_URL && KEY);
export const serverName = SERVER_URL;

/** Longer than this, the server is not answering: given up. */
const TIMEOUT_MS = 30_000;
/** Said through Snapcast, it answers once heard: Piper, and the whole answer read. */
const SPEECH_TIMEOUT_MS = 90_000;

async function request(
	path: string,
	body: Uint8Array | string,
	type: string,
	timeout = TIMEOUT_MS
) {
	const res = await fetch(`${SERVER_URL}${path}`, {
		method: 'POST',
		headers: { 'x-api-key': KEY!, 'content-type': type },
		body,
		signal: AbortSignal.timeout(timeout)
	});
	if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res;
}

async function post<T>(path: string, body: Uint8Array | string, type: string): Promise<T> {
	return (await request(path, body, type)).json() as Promise<T>;
}

/**
 * The answer read aloud by the server's Piper, as a WAV; null if the server said it through
 * Snapcast (Ajustes → Casa), once heard.
 */
export async function speech(text: string) {
	const body = JSON.stringify({ text });
	const res = await request('/api/voice/speak', body, 'application/json', SPEECH_TIMEOUT_MS);
	if (res.status === 204) return null;
	return new Uint8Array(await res.arrayBuffer());
}

let history: VoiceTurn[] = [];
let lastAt = 0;

/** What was said and its answer; null if nothing was understood. */
export async function sendOrder(wav: Uint8Array) {
	const { text } = await post<{ text: string }>('/api/voice/transcribe', wav, 'audio/wav');
	if (!text?.trim()) return null;
	if (Date.now() - lastAt > HISTORY_IDLE_MS) history = [];
	const reply = await post<VoiceReply>(
		'/api/voice/command',
		JSON.stringify({ text, history }),
		'application/json'
	);
	history = [
		...history,
		{ role: 'user' as const, content: text },
		{ role: 'assistant' as const, content: reply.reply }
	].slice(-HISTORY_TURNS);
	lastAt = Date.now();
	return { text, reply };
}

/**
 * The living room's TV (mpv) lower while listening and answering, as from the phone. Without mpv
 * (404) or the server not answering, nothing: it only helps to hear the order.
 */
export function duck(on: boolean) {
	if (!serverReady) return;
	post('/api/salon/bajar', JSON.stringify({ on }), 'application/json').catch(() => {});
}
