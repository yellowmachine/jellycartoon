import { createHash, randomBytes } from 'node:crypto';
import {
	getAppSetting,
	openRouterConfig,
	openRouterManagementKey,
	setAppSetting
} from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';

/** Where the account's credit is bought, and seen. */
export const CREDITS_URL = 'https://openrouter.ai/settings/credits';

/** Said wherever the AI fails for it: voice, the DJ, a film's card… */
export const NO_CREDIT = `Se ha acabado el crédito de OpenRouter (o la clave ha llegado a su límite): recárgalo en ${CREDITS_URL}`;

/**
 * When a request was refused for the credit. Until someone says it was recharged (the banner's «Ya
 * he recargado», `creditRecharged`), no request goes out: each would fail, fill the Registro and
 * leave what it was for half done. Kept in the database, so that a restart does not forget it;
 * `undefined` until read from there.
 */
let creditOutAt: Date | null | undefined;

async function loadCreditOut() {
	if (creditOutAt === undefined) {
		const saved = await getAppSetting('openrouter_credit_out').catch(() => null);
		creditOutAt ??= saved ? new Date(saved) : null;
	}
	return creditOutAt;
}

function setCreditOut(at: Date | null) {
	creditOutAt = at;
	setAppSetting('openrouter_credit_out', at?.toISOString() ?? null).catch((error) =>
		log.warn('ia', 'No se pudo guardar el estado del crédito', { error })
	);
}

/** For Ajustes and the banner: when the credit ran out, or null. */
export const creditRunOutAt = () => loadCreditOut();

/** «Ya he recargado»: the next request goes out again (and, without credit, it is blocked again). */
export function creditRecharged() {
	if (creditOutAt === null) return;
	log.info('ia', 'Crédito de OpenRouter recargado: vuelven a salir las peticiones');
	setCreditOut(null);
}

/** Before every request that spends: none while the credit has run out. */
async function needCredit() {
	if (await loadCreditOut()) throw new Error(NO_CREDIT);
}

/** OpenRouter's error object, in the body or in a stream: https://openrouter.ai/docs/api/reference/errors-and-debugging */
interface OpenRouterError {
	code?: number | string;
	message?: string;
	metadata?: { limit_source?: string };
}

/**
 * The error to throw: with no credit left (402), said so for a person. Not one that only waits
 * for requests already running (`openrouter_in_flight_budget`), which goes by itself.
 */
function failure(error: OpenRouterError | undefined, fallback: string) {
	if (
		Number(error?.code) === 402 &&
		error?.metadata?.limit_source !== 'openrouter_in_flight_budget'
	) {
		if (!creditOutAt) {
			log.warn('ia', `${NO_CREDIT}. No se le pide nada más hasta que se pulse «Ya he recargado».`);
			setCreditOut(new Date());
		}
		return new Error(NO_CREDIT);
	}
	return new Error(`OpenRouter: ${error?.message ?? fallback}`);
}

/** A refused answer's error, with its HTTP status when the body has no code. */
const refused = (res: Response, body: { error?: OpenRouterError } | null) =>
	failure({ ...body?.error, code: body?.error?.code ?? res.status }, res.statusText);

/** What OpenRouter says a request used and cost, in every answer: https://openrouter.ai/docs/guides/guides/usage-accounting */
export interface Usage {
	prompt_tokens?: number;
	completion_tokens?: number;
	/** In dollars (credits). */
	cost?: number;
	prompt_tokens_details?: { cached_tokens?: number };
}

const tokens = (n: number) => n.toLocaleString('es-ES');

/** E.g. `12.345 + 678 tokens (10.000 de caché), 0,0213 $`. */
export function describeUsage(usage: Usage | undefined) {
	if (!usage) return 'sin datos de uso';
	const cached = usage.prompt_tokens_details?.cached_tokens;
	return [
		`${tokens(usage.prompt_tokens ?? 0)} + ${tokens(usage.completion_tokens ?? 0)} tokens`,
		cached ? ` (${tokens(cached)} de caché)` : '',
		usage.cost !== undefined
			? `, ${usage.cost.toLocaleString('es-ES', { maximumFractionDigits: 4 })} $`
			: ''
	].join('');
}

const costListeners = new Set<(dollars: number) => void>();

/** What each request to the AI costs, as it comes back: the month's line (#193) adds it up. */
export function watchCost(listener: (dollars: number) => void) {
	costListeners.add(listener);
	return () => void costListeners.delete(listener);
}

/** One line in the Registro for every request to the AI: what it was for, and what it cost. */
function logUsage(
	label: string,
	body: { model?: string; provider?: string; usage?: Usage },
	details?: Record<string, unknown>
) {
	// Went through: there is credit again.
	if (creditOutAt) setCreditOut(null);
	const cost = body.usage?.cost;
	if (typeof cost === 'number' && cost > 0) for (const listener of costListeners) listener(cost);
	log.info('ia', `${label}: ${describeUsage(body.usage)}`, {
		model: body.model,
		provider: body.provider,
		usage: body.usage,
		...details
	});
}

/**
 * One request to OpenRouter's chat completions API, answered as JSON that follows `schema`
 * (structured outputs): https://openrouter.ai/docs/features/structured-outputs
 */
export async function completeJson<T>(request: {
	system: string;
	/** Text, or text and images: https://openrouter.ai/docs/guides/overview/multimodal/images */
	prompt: string | ContentPart[];
	/** Name of the schema, e.g. `film`. */
	name: string;
	/** What it is for, for the Registro: e.g. `Sinopsis de «Tiburón»`. */
	label: string;
	/** Also for the Registro: e.g. the film's id. */
	details?: Record<string, unknown>;
	schema: Record<string, unknown>;
	/** Instead of the one in Ajustes. */
	model?: string;
	timeoutMs?: number;
	/** Longest answer, in tokens; see `max_tokens` below. */
	maxTokens?: number;
	/** To cancel it before the timeout. */
	signal?: AbortSignal;
}): Promise<T> {
	await needCredit();
	const config = await openRouterConfig();
	const { apiKey } = config;
	const model = request.model ?? config.model;
	if (!apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');

	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			// Optional attribution, so the app shows by name in OpenRouter's activity page.
			'X-OpenRouter-Title': 'JellyCartoon'
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.prompt }
			],
			// Without it, OpenRouter reserves credit for the model's longest answer (64k tokens) and
			// refuses the request when the key has less left, however short the real answer:
			// https://openrouter.ai/docs/api/reference/parameters#max-tokens. Room to spare: a
			// reasoning model (GPT-5, o3…) spends them thinking too, and with none left it answers
			// nothing: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
			max_tokens: request.maxTokens ?? 16_384,
			// No `temperature`: the newest models do not take it, and with `require_parameters` a
			// parameter no provider supports leaves no provider at all.
			response_format: {
				type: 'json_schema',
				json_schema: { name: request.name, strict: true, schema: request.schema }
			},
			// Only providers that honour the schema.
			provider: { require_parameters: true }
		}),
		signal: AbortSignal.any([
			AbortSignal.timeout(request.timeoutMs ?? 60_000),
			...(request.signal ? [request.signal] : [])
		])
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res, body);
	// Errors once the provider has started answering come with a 200, inside the choice:
	// https://openrouter.ai/docs/api/reference/errors-and-debugging
	const choice = body?.choices?.[0];
	const content = choice?.message?.content;
	const provider = body?.provider ? ` (${body.provider})` : '';
	// Billed even when it fails, e.g. a reasoning model that thought until it ran out of tokens.
	if (body?.usage) logUsage(request.label, body, request.details);
	if (typeof content !== 'string' || !content.trim()) {
		const error = body?.error ?? choice?.error;
		if (Number(error?.code) === 402) throw failure(error, '');
		const why =
			body?.error?.message ??
			choice?.error?.message ??
			(choice?.finish_reason === 'length'
				? 'se quedó sin tokens (razonando) antes de responder'
				: choice?.finish_reason &&
					`terminó con ${choice.native_finish_reason ?? choice.finish_reason}`);
		throw new Error(`OpenRouter: respuesta vacía${provider}${why ? `: ${why}` : ''}`);
	}
	if (choice.finish_reason === 'length')
		throw new Error(`OpenRouter: la respuesta se cortó por larga${provider}`);
	return JSON.parse(content) as T;
}

export type ContentPart = TextPart | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type ChatEvent = { text: string } | { sources: { url: string; title: string }[] };

/**
 * A conversation, answered as it is written (streaming):
 * https://openrouter.ai/docs/api/reference/streaming. With `web`, the model can search the web
 * and the pages it used come as sources: https://openrouter.ai/docs/guides/features/plugins/web-search
 */
/** Nothing from OpenRouter in this long, not even its keep-alives: the answer is stuck. */
const STREAM_IDLE_MS = 60_000;

export async function* streamChat(request: {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	web: boolean;
	/** For the Registro, as in `completeJson`. */
	label: string;
	details?: Record<string, unknown>;
	/** Aborting stops the generation (and its billing, with most providers). */
	signal: AbortSignal;
}): AsyncGenerator<ChatEvent> {
	await needCredit();
	// Without it, a stream that stops halfway would keep the answer «being written» for good.
	const idle = new AbortController();
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const stillAlive = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => idle.abort(new Error('OpenRouter ha dejado de responder')),
			STREAM_IDLE_MS
		);
	};
	stillAlive();
	try {
		const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${request.apiKey}`,
				'Content-Type': 'application/json',
				'X-OpenRouter-Title': 'JellyCartoon'
			},
			body: JSON.stringify({
				model: request.model,
				messages: request.messages,
				stream: true,
				// As in `completeJson`: a long answer and the thinking of a reasoning model, without
				// reserving credit for 64k tokens.
				max_tokens: 16_384,
				...(request.web && { plugins: [{ id: 'web' }] }),
				// The film's articles are long and go with every question: Anthropic caches them only
				// when asked (https://openrouter.ai/docs/guides/best-practices/prompt-caching); the
				// other providers do it by themselves.
				...(request.model.startsWith('anthropic/') && { cache_control: { type: 'ephemeral' } })
			}),
			signal: AbortSignal.any([request.signal, idle.signal])
		});
		if (!res.ok || !res.body) {
			throw refused(res, await res.json().catch(() => null));
		}

		const seen = new Set<string>();
		let buffer = '';
		for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
			stillAlive();
			buffer += chunk;
			const lines = buffer.split('\n');
			buffer = lines.pop()!;
			for (const line of lines) {
				// Lines starting with `:` are keep-alives (`: OPENROUTER PROCESSING`).
				if (!line.startsWith('data: ')) continue;
				const data = line.slice(6).trim();
				if (data === '[DONE]') return;
				const event = JSON.parse(data);
				// Errors after the answer has started come inside the stream.
				if (event.error) throw failure(event.error, String(event.error.code));
				// The usage comes in the last message, with no text.
				if (event.usage) logUsage(request.label, event, request.details);
				const delta = event.choices?.[0]?.delta;
				if (delta?.content) yield { text: delta.content };
				const sources = (
					(delta?.annotations ?? []) as { url_citation?: { url: string; title?: string } }[]
				)
					.map((a) => a.url_citation)
					.filter((c): c is { url: string; title?: string } => !!c?.url && !seen.has(c.url))
					.map((c) => (seen.add(c.url), { url: c.url, title: c.title || new URL(c.url).hostname }));
				if (sources.length) yield { sources };
			}
		}
	} finally {
		clearTimeout(idleTimer);
	}
}

/** Models whose thinking can be turned off, from OpenRouter's list; read once per process. */
let thinkingOptional: Promise<Set<string>> | undefined;

/**
 * Whether `effort: "none"` can go with `model`: those whose reasoning is mandatory refuse it
 * (https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). If the list cannot be read,
 * no: the model thinks, as before, but answers.
 */
async function canSkipThinking(model: string) {
	thinkingOptional ??= fetch('https://openrouter.ai/api/v1/models', {
		signal: AbortSignal.timeout(10_000)
	})
		.then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
		.then(
			(body: {
				data: { id: string; reasoning?: { mandatory?: boolean; supported_efforts?: string[] } }[];
			}) =>
				new Set(
					body.data
						.filter(
							(m) => !m.reasoning?.mandatory && m.reasoning?.supported_efforts?.includes('none')
						)
						.map((m) => m.id)
				)
		)
		.catch((error) => {
			log.warn('ia', 'No se pudo leer qué modelos dejan de pensar', { error });
			thinkingOptional = undefined;
			return new Set<string>();
		});
	return (await thinkingOptional).has(model);
}

/** A function the model can call: https://openrouter.ai/docs/guides/features/tool-calling */
export interface Tool {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
	id: string;
	type: 'function';
	/** `arguments` is JSON, as the model wrote it: it may not follow the schema. */
	function: { name: string; arguments: string };
}

/**
 * Text in parts; a part with `cache_control` is cached up to it, for Anthropic's models:
 * https://openrouter.ai/docs/guides/best-practices/prompt-caching
 */
export type TextPart = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

export type ToolChatMessage =
	| { role: 'system' | 'user'; content: string | TextPart[] }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string };

/**
 * A question answered with the web (#243, the voice's `web_search`), through OpenRouter's web plugin:
 * https://openrouter.ai/docs/guides/features/plugins/web-search. Its words, short; about a cent
 * each (0,012 $ with 5 results, measured on 2026-10-27) and some seconds more.
 */
export async function askWeb(request: {
	model: string;
	system: string;
	prompt: string;
	label: string;
	details?: Record<string, unknown>;
	timeoutMs?: number;
}) {
	await needCredit();
	const { apiKey } = await openRouterConfig();
	if (!apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'X-OpenRouter-Title': 'JellyCartoon'
		},
		body: JSON.stringify({
			model: request.model,
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.prompt }
			],
			plugins: [{ id: 'web', max_results: 5 }],
			max_tokens: 2048
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res, body);
	if (body?.usage) logUsage(request.label, body, request.details);
	const content = body?.choices?.[0]?.message?.content;
	if (typeof content !== 'string' || !content.trim()) {
		const error = body?.error ?? body?.choices?.[0]?.error;
		throw failure(error, 'no ha contestado');
	}
	return content.trim();
}

/**
 * One turn of a conversation with tools: the model answers with text, or with the tools it wants
 * called. The caller runs them, adds their results as `tool` messages and asks again.
 */
export async function chatWithTools(request: {
	model: string;
	messages: ToolChatMessage[];
	tools: Tool[];
	/** For the Registro, as in `completeJson`. */
	label: string;
	details?: Record<string, unknown>;
	timeoutMs?: number;
	/** False, without thinking first when the model allows it: the voice, where each second shows. */
	think?: boolean;
}): Promise<{ content: string | null; toolCalls: ToolCall[]; usage: Usage | null }> {
	await needCredit();
	const { apiKey } = await openRouterConfig();
	if (!apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');
	const noThinking = request.think === false && (await canSkipThinking(request.model));

	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'X-OpenRouter-Title': 'JellyCartoon'
		},
		body: JSON.stringify({
			model: request.model,
			messages: request.messages,
			tools: request.tools,
			// As in `completeJson`; short answers here, but room for a model that reasons.
			max_tokens: 4_096,
			...(noThinking && { reasoning: { effort: 'none' } }),
			// Only providers that take tools.
			provider: { require_parameters: true }
			// No caching of its own: the caller marks what does not change (a `TextPart`).
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res, body);
	if (body?.usage) logUsage(request.label, body, request.details);
	const choice = body?.choices?.[0];
	const message = choice?.message;
	if (!message) {
		const error = body?.error ?? choice?.error;
		if (Number(error?.code) === 402) throw failure(error, '');
		const why = body?.error?.message ?? choice?.error?.message;
		throw new Error(`OpenRouter: respuesta vacía${why ? `: ${why}` : ''}`);
	}
	return {
		content: typeof message.content === 'string' && message.content.trim() ? message.content : null,
		toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
		usage: body.usage ?? null
	};
}

/**
 * `input` read aloud (https://openrouter.ai/docs/guides/overview/multimodal/tts), as raw PCM: 16-bit,
 * mono, at `rate` (Gemini's speech models give only that). `instructions` say how, without being
 * read.
 */
export async function speech(request: {
	model: string;
	voice: string;
	input: string;
	instructions?: string;
	timeoutMs?: number;
}): Promise<{ pcm: Uint8Array; rate: number }> {
	await needCredit();
	const { apiKey } = await openRouterConfig();
	if (!apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');
	const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'X-OpenRouter-Title': 'JellyCartoon'
		},
		body: JSON.stringify({
			model: request.model,
			voice: request.voice,
			input: request.input,
			...(request.instructions && { instructions: request.instructions }),
			response_format: 'pcm'
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 60_000)
	});
	if (!res.ok) throw refused(res, await res.json().catch(() => null));
	// Went through: there is credit again.
	if (creditOutAt) setCreditOut(null);
	// E.g. `audio/pcm;rate=24000;channels=1`.
	const rate = Number(/rate=(\d+)/.exec(res.headers.get('content-type') ?? '')?.[1]) || 24_000;
	return { pcm: new Uint8Array(await res.arrayBuffer()), rate };
}

/** The account's own credit, with a management key: bought, used and left, in dollars. */
export interface AccountCredits {
	bought: number;
	used: number;
	left: number;
}

/** What the key has spent and its own limit, in dollars; the account's real credit if known. */
export interface KeyBalance {
	/** The key's own limit, if it has one (not the account's credit). */
	limit: number | null;
	left: number | null;
	spent: { day: number; week: number; month: number; total: number };
	/** Only with a management key in Ajustes; null when it failed (`creditsProblem`). */
	credits: AccountCredits | null;
	creditsProblem: string | null;
	/** The last request refused for the credit, if none has gone through since. */
	creditOutAt: Date | null;
}

/**
 * The account's credit, which needs a management key:
 * https://openrouter.ai/docs/api/api-reference/credits/get-credits. Throws, said for a person.
 */
export async function accountCredits(managementKey: string): Promise<AccountCredits> {
	const res = await fetch('https://openrouter.ai/api/v1/credits', {
		headers: { Authorization: `Bearer ${managementKey}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 401 || res.status === 403)
		throw new Error('OpenRouter no la acepta: tiene que ser una clave de gestión (management key)');
	if (!res.ok) throw new Error(`OpenRouter: ${res.status} ${res.statusText}`);
	const { data } = await res.json();
	const bought = Number(data?.total_credits ?? 0);
	const used = Number(data?.total_usage ?? 0);
	return { bought, used, left: bought - used };
}

/**
 * What the key has spent, with the key itself (https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key),
 * and the account's credit with the management key, if there is one. Null when there is no key or
 * no answer.
 */
export async function keyBalance(): Promise<KeyBalance | null> {
	const [{ apiKey }, managementKey] = await Promise.all([
		openRouterConfig(),
		openRouterManagementKey()
	]);
	if (!apiKey) return null;
	try {
		const [res, credits] = await Promise.all([
			fetch('https://openrouter.ai/api/v1/key', {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(10_000)
			}),
			managementKey
				? accountCredits(managementKey).then(
						(credits) => ({ credits, problem: null }),
						(error: Error) => ({ credits: null, problem: error.message })
					)
				: { credits: null, problem: null }
		]);
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		const { data } = await res.json();
		return {
			limit: data.limit ?? null,
			left: data.limit_remaining ?? null,
			spent: {
				day: data.usage_daily ?? 0,
				week: data.usage_weekly ?? 0,
				month: data.usage_monthly ?? 0,
				total: data.usage ?? 0
			},
			credits: credits.credits,
			creditsProblem: credits.problem,
			creditOutAt: await loadCreditOut()
		};
	} catch (error) {
		log.warn('ia', 'No se pudo consultar el saldo de OpenRouter', { error });
		return null;
	}
}

/**
 * «Conectar con OpenRouter»: the person signs in there (or makes the account) and authorises the
 * app, and it gets a key of its own, billed to their credit. OAuth with PKCE:
 * https://openrouter.ai/docs/guides/overview/auth/oauth
 */
export function openRouterAuth(callbackUrl: string) {
	const verifier = randomBytes(32).toString('base64url');
	const state = randomBytes(16).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const url = new URL('https://openrouter.ai/auth');
	url.searchParams.set('callback_url', callbackUrl);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);
	url.searchParams.set('key_label', 'JellyCartoon');
	return { url: url.href, verifier, state };
}

/** The PKCE verifier and the state, from «Conectar» until OpenRouter sends the browser back. */
export const OAUTH_COOKIE = 'openrouter_oauth';

/** The code OpenRouter came back with, for the key (single use, valid 10 minutes). */
export async function openRouterKeyFromCode(code: string, verifier: string) {
	const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
		signal: AbortSignal.timeout(15_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || typeof body?.key !== 'string')
		throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	return body.key as string;
}
