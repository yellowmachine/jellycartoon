import {
	assistantTurn,
	HEARING_KEY_HEADER,
	HISTORY_IDLE_MS,
	HISTORY_TURNS,
	type DirectHearing,
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
/** Heard ahead of time: longer than this, it goes the usual way. */
const EARLY_TIMEOUT_MS = 5000;
/** The house's Whisper, directly (#430): longer than this, it goes through the server. */
const DIRECT_TIMEOUT_MS = 1000;

/** Seilide's: where to hear directly; null, through it. */
let hearing: DirectHearing | null = null;
export const setHearing = (where: DirectHearing | null) => {
	hearing = where;
};

/**
 * What was said, by the house's Whisper with nothing in between (#430). Null if it goes through the
 * server: no address, cut, too slow or failing. Empty if nothing was said.
 */
async function hearDirect(wav: Uint8Array, signal?: AbortSignal) {
	if (!hearing) return null;
	const started = Date.now();
	try {
		const timeout = AbortSignal.timeout(DIRECT_TIMEOUT_MS);
		const res = await fetch(hearing.url, {
			method: 'POST',
			headers: { [HEARING_KEY_HEADER]: hearing.key, 'content-type': 'audio/wav' },
			body: wav,
			signal: signal ? AbortSignal.any([timeout, signal]) : timeout
		});
		if (!res.ok) throw new Error(`${res.status}`);
		const { text } = (await res.json()) as { text: string };
		console.log(`Oído en la casa, directo, en ${Date.now() - started} ms`);
		return text;
	} catch (err) {
		if (!signal?.aborted)
			console.error(`Whisper directo: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

/** The server answered, with an error: its status says which. */
export class ServerError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function request(
	path: string,
	body: Uint8Array | string,
	type: string,
	timeout = TIMEOUT_MS,
	extra: { signal?: AbortSignal; headers?: Record<string, string> } = {}
) {
	const res = await fetch(`${SERVER_URL}${path}`, {
		method: 'POST',
		headers: { 'x-api-key': KEY!, 'content-type': type, ...extra.headers },
		body,
		signal: extra.signal
			? AbortSignal.any([AbortSignal.timeout(timeout), extra.signal])
			: AbortSignal.timeout(timeout)
	});
	if (!res.ok)
		throw new ServerError(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
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
 * What was said up to now, while it may still go on (early.ts): `x-early`, only if it costs nothing
 * (the house's Whisper), so a pause is not paid for. Never fails: null, it goes the usual way.
 */
export async function hearEarly(wav: Uint8Array, signal: AbortSignal) {
	const direct = await hearDirect(wav, signal);
	if (direct !== null) return direct.trim() ? direct : null;
	if (signal.aborted) return null;
	try {
		const res = await request('/api/voice/transcribe', wav, 'audio/wav', EARLY_TIMEOUT_MS, {
			signal,
			headers: { 'x-early': '1' }
		});
		if (res.status === 204) return null;
		const { text } = (await res.json()) as { text: string };
		return text?.trim() ? text : null;
	} catch {
		return null;
	}
}

/**
 * What was said and its answer; null if nothing was understood. `onHeard`, once it is known what
 * was said, as the AI starts on it. `heard`, what was heard ahead of time, if it was; without text,
 * the order is sent whole. Its timers and alarms the server keeps (#241): it tells the AI.
 */
export async function sendOrder(
	wav: Uint8Array,
	onHeard?: (text: string) => void,
	heard?: Promise<string | null> | null
) {
	const text =
		(await heard) ??
		(await hearDirect(wav)) ??
		(await post<{ text: string }>('/api/voice/transcribe', wav, 'audio/wav')).text;
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
	/** Seilide's (#296): the snapserver it plays from, for its own snapclient; null, none. */
	snapserver?: string | null;
	/** And its name, for it to be known so there: «Dormitorio»; and its id there. */
	name?: string;
	snapclientId?: string;
	/** Seilide's (#331): what it is to say once, out loud (a rule's notice), by its id. */
	say?: { id: string; text: string }[];
	/** Seilide's: which voice the family has, for its own phrases (fallback.ts). */
	voice?: string;
	/** Seilide's: what it says on hearing its word instead of the beep (fallback.ts); none, the beep. */
	greetings?: string[];
	/** Seilide's: the word of all the family's satellites; null, each its own (`WAKE_WORD`). */
	wakeWord?: string | null;
	/** Seilide's (#430): its house's Whisper, to go to directly; null, through the server. */
	hearing?: DirectHearing | null;
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

/** Said once (#331): the server forgets it. */
export async function saidOnce(id: string) {
	await request('/api/satelite/avisos/dicho', JSON.stringify({ id }), 'application/json');
}
