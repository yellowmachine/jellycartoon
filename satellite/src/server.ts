import {
	assistantTurn,
	HISTORY_IDLE_MS,
	HISTORY_TURNS,
	type VoiceReply,
	type VoiceTurn
} from '../../packages/comun/src/voice.ts';

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
 * Snapcast (Ajustes → Casa), once heard. With `chime`, a timer's «din-don» before it.
 */
export async function speech(text: string, { chime = false } = {}) {
	const body = JSON.stringify({ text, chime });
	const res = await request('/api/voice/speak', body, 'application/json', SPEECH_TIMEOUT_MS);
	if (res.status === 204) return null;
	return new Uint8Array(await res.arrayBuffer());
}

let history: VoiceTurn[] = [];
let lastAt = 0;

/**
 * One of the phrases said while the AI thinks («Vale», Ajustes → Casa), as `speech`'s: a WAV, or
 * null if the server said it through Snapcast (at once) or there are none.
 */
export async function filler() {
	const body = JSON.stringify({ filler: true });
	const res = await request('/api/voice/speak', body, 'application/json');
	if (res.status === 204) return null;
	return new Uint8Array(await res.arrayBuffer());
}

/**
 * What was said and its answer; null if nothing was understood. `onHeard`, once it is known what
 * was said, as the AI starts on it. Its timers and alarms the server keeps (#241): it tells the AI.
 */
export async function sendOrder(wav: Uint8Array, onHeard?: (text: string) => void) {
	const { text } = await post<{ text: string }>('/api/voice/transcribe', wav, 'audio/wav');
	if (!text?.trim()) return null;
	onHeard?.(text);
	if (Date.now() - lastAt > HISTORY_IDLE_MS) history = [];
	const reply = await post<VoiceReply>(
		'/api/voice/command',
		JSON.stringify({ text, history }),
		'application/json'
	);
	history = [...history, { role: 'user' as const, content: text }, assistantTurn(reply)].slice(
		-HISTORY_TURNS
	);
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

/** What rings where the satellite is (#241): all of it, which «hola casita» stops; and what it says itself. */
export interface Ringing {
	ringing: string[];
	play: string[];
}

/** After a dropped channel, tried again this long after. */
const RETRY_MS = 5000;

/**
 * Its alarms and timers, as the server keeps them, live (/api/satelite/avisos, server-sent
 * events): `onState` with each change. Connected again whenever it drops (the server restarted,
 * the network), for good.
 */
export async function followAlarms(onState: (state: Ringing) => void): Promise<never> {
	for (;;) {
		try {
			const res = await fetch(`${SERVER_URL}/api/satelite/avisos`, {
				headers: { 'x-api-key': KEY!, accept: 'text/event-stream' }
			});
			if (!res.ok || !res.body) throw new Error(`${res.status}`);
			const decoder = new TextDecoder();
			let pending = '';
			for await (const chunk of res.body) {
				pending += decoder.decode(chunk, { stream: true });
				let end: number;
				while ((end = pending.indexOf('\n\n')) >= 0) {
					const event = pending.slice(0, end);
					pending = pending.slice(end + 2);
					const data = event
						.split('\n')
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trim())
						.join('');
					if (data) onState(JSON.parse(data) as Ringing);
				}
			}
		} catch (err) {
			console.error('Sin canal de avisos:', err instanceof Error ? err.message : String(err));
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
}

/** «Hola casita» while something rings: it stops (#241). How many. */
export async function stopAlarms() {
	const res = await request('/api/satelite/avisos/parar', '{}', 'application/json');
	return ((await res.json()) as { stopped: number }).stopped;
}
