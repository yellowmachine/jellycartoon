/**
 * Each family's AI stopped when OpenRouter keeps saying no (by its key, as ai-lane.ts): no credit,
 * not enough for the request, the key's own limit reached, or a key it refuses. Then nothing goes out, every request fails at
 * once with why, until someone says «Ya he recargado», the key changes, or a try every
 * `PROBE_MS` comes back well. As the house's, which stops at the first no credit (its
 * openrouter.ts); here at the third in `WINDOW_MS`, as a 402 is not always no credit: «given your
 * current in-flight requests» is too much asked at once, tried again in a moment and never counted.
 */

/** Our words for OpenRouter's no: the voice reads them aloud. */
export const NO_CREDIT = 'No queda saldo en OpenRouter';
export const SHORT_CREDIT = 'El saldo de OpenRouter no llega para esto';
export const TOO_MANY = 'OpenRouter tiene demasiadas peticiones a la vez';
export const BAD_KEY = 'OpenRouter no acepta la clave: cámbiala en Ajustes';
/** The key's own spending limit (openrouter.ai/keys), not the account's credit: recharging does not help. */
export const KEY_LIMIT = 'La clave de OpenRouter ha llegado a su límite de gasto';

/** OpenRouter's no, as it sends it: https://openrouter.ai/docs/api/reference/limits */
export interface OpenRouterError {
	message?: string;
	/** Why a 402: `openrouter_in_flight_budget`, `openrouter_key_limit` or `openrouter_credits`. */
	metadata?: { limit_source?: string } | null;
}

/** Our words for a no from OpenRouter, from its status and its error; null, another no. */
export function refusalWords(status: number, error: OpenRouterError | null | undefined) {
	const message = error?.message ?? '';
	// Already ours: a stopped family's no, answered to an app (openrouter.ts).
	if (accountProblem(message)) return message;
	if (status === 401) return BAD_KEY;
	if (status !== 402) return null;
	switch (error?.metadata?.limit_source) {
		case 'openrouter_in_flight_budget':
			return TOO_MANY;
		case 'openrouter_key_limit':
			return KEY_LIMIT;
	}
	// Without its source (or `openrouter_credits`), by its words.
	if (/in-flight/i.test(message)) return TOO_MANY;
	if (/maximum cost|can only afford|fewer max_tokens/i.test(message)) return SHORT_CREDIT;
	return NO_CREDIT;
}

/** The family's key or credit: another model, or asking again, would not do better. */
export const accountProblem = (message: string) =>
	[NO_CREDIT, SHORT_CREDIT, TOO_MANY, BAD_KEY, KEY_LIMIT].includes(message);

/** The credit's words, said as «no credit» by the voice (and a satellite's 402). */
export const creditProblem = (message: string) => message === NO_CREDIT || message === SHORT_CREDIT;

/** Stopped: the request did not go out. Its message is why, in our words. */
export class AiBlocked extends Error {}

/** Nos that count, this many in `WINDOW_MS`, stop it; a key refused, the first. */
const FAILS = 3;
const WINDOW_MS = 10 * 60_000;
/** Stopped, one request goes out after this long, to see whether it can go on. */
const PROBE_MS = 15 * 60_000;
/** A «too many at once», asked again once: after its `Retry-After`, between these. */
const AGAIN_MS = 3_000;
const AGAIN_MAX_MS = 10_000;

export interface Block {
	at: Date;
	why: string;
}

interface State {
	/** When each no that counts came, in `WINDOW_MS`. */
	fails: number[];
	block: Block | null;
	/** Stopped: when the next try may go out. */
	probeAt: number;
}

const states = new Map<string, State>();

const stateOf = (apiKey: string) => {
	let state = states.get(apiKey);
	if (!state) states.set(apiKey, (state = { fails: [], block: null, probeAt: 0 }));
	return state;
};

const listeners = new Set<(apiKey: string, block: Block | null) => void>();

/** Each time a family's AI stops or goes on again (family-settings.ts keeps it, and tells). */
export function watchBlocks(listener: (apiKey: string, block: Block | null) => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function setBlock(apiKey: string, block: Block | null) {
	const state = stateOf(apiKey);
	state.block = block;
	state.fails = [];
	state.probeAt = block ? block.at.getTime() + PROBE_MS : 0;
	console.warn(
		block
			? `[ia] IA de la familia parada: ${block.why}`
			: '[ia] IA de la familia en marcha otra vez'
	);
	for (const listener of listeners) listener(apiKey, block);
}

/** Keys whose kept block has been read, once per process: from then on, this module's. */
const remembered = new Set<string>();

/** As it was kept, the first time the key is read after a restart: without telling anyone again. */
export function rememberBlock(apiKey: string, block: Block | null) {
	if (remembered.has(apiKey)) return;
	remembered.add(apiKey);
	const state = stateOf(apiKey);
	if (state.block) return;
	state.block = block;
	state.probeAt = block ? Math.max(Date.now(), block.at.getTime() + PROBE_MS) : 0;
}

/** «Ya he recargado», or the key changed: the next request goes out. */
export function unblock(apiKey: string) {
	if (stateOf(apiKey).block) setBlock(apiKey, null);
}

/** Stopped, and why; null, going. */
export const blockOf = (apiKey: string) => states.get(apiKey)?.block ?? null;

/**
 * A no from OpenRouter with this key, in our words: counted, and the AI stopped at `FAILS` (a key
 * refused, at once). Also for a no inside an answer that came with a 200.
 */
export function noteRefusal(apiKey: string, words: string) {
	if (words === TOO_MANY || !accountProblem(words)) return;
	const state = stateOf(apiKey);
	const now = Date.now();
	if (state.block) {
		// The try came back no: the next one, later.
		state.probeAt = now + PROBE_MS;
		return;
	}
	state.fails = [...state.fails.filter((t) => now - t < WINDOW_MS), now];
	if (words === BAD_KEY || state.fails.length >= FAILS)
		setBlock(apiKey, { at: new Date(now), why: words });
}

/**
 * A request to OpenRouter with this key (`send`, through its lane): not sent while stopped, but a
 * try every `PROBE_MS`; a «too many at once» asked again once, when OpenRouter says (`Retry-After`,
 * at most `AGAIN_MAX_MS`); its no counted.
 * The answer as it came, for the caller to read.
 */
export async function guarded(apiKey: string, send: () => Promise<Response>) {
	const state = stateOf(apiKey);
	const probing = Boolean(state.block);
	if (state.block) {
		if (Date.now() < state.probeAt) throw new AiBlocked(state.block.why);
		state.probeAt = Date.now() + PROBE_MS;
	}
	let res = await send();
	let words = await wordsOf(res);
	if (words === TOO_MANY) {
		await new Promise((resolve) => setTimeout(resolve, againIn(res)));
		res = await send();
		words = await wordsOf(res);
	}
	if (words) noteRefusal(apiKey, words);
	else if (res.ok) {
		if (probing) setBlock(apiKey, null);
		else state.fails = [];
	}
	return res;
}

/** A no's words, ours; null, another answer. Its body stays for the caller. */
async function wordsOf(res: Response) {
	if (res.status !== 401 && res.status !== 402) return null;
	const body = await res
		.clone()
		.json()
		.catch(() => null);
	logRefusal(res.status, body?.error);
	return refusalWords(res.status, body?.error);
}

/** OpenRouter's no in the log, in its words and with its source. */
export function logRefusal(status: number, error: OpenRouterError | null | undefined) {
	const source = error?.metadata?.limit_source;
	console.warn(
		`[ia] OpenRouter dice ${status}${source ? ` (${source})` : ''}:`,
		error?.message || '(sin mensaje)'
	);
}

/** How long before asking again: its `Retry-After`, in seconds, or `AGAIN_MS`; never over `AGAIN_MAX_MS`. */
function againIn(res: Response) {
	const seconds = Number(res.headers.get('retry-after'));
	const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : AGAIN_MS;
	return Math.min(ms, AGAIN_MAX_MS);
}

/** For the tests: as at the start. */
export function forgetBlocks() {
	states.clear();
	remembered.clear();
}
