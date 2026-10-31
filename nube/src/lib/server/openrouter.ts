import {
	accountProblem,
	BAD_KEY,
	AiBlocked,
	guarded,
	noteRefusal,
	refusalWords
} from '#lib/server/ai-block.ts';
import { throughLane } from '#lib/server/ai-lane.ts';
/**
 * OpenRouter (https://openrouter.ai), with the family's own key (family-settings.ts): an answer as
 * JSON to a schema, as jellycartoon's `completeJson`. Each request's cost goes to the spending's
 * line (#193, ai-spend.ts).
 */

export { NO_CREDIT } from '#lib/server/ai-block.ts';

/** A request with the family's key: in its lane (ai-lane.ts), and not while its AI is stopped (ai-block.ts). */
const send = (apiKey: string, fetchIt: () => Promise<Response>) =>
	guarded(apiKey, () => throughLane(apiKey, fetchIt));

/** jellycartoon's defaults: short tasks, and photos (receipts, bills). */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
export const VISION_MODEL = 'anthropic/claude-sonnet-5.5';

/** Text, or text and images: https://openrouter.ai/docs/guides/overview/multimodal/images */
export type ContentPart =
	{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const costListeners = new Set<(apiKey: string, label: string, dollars: number) => void>();

/** What each request to the AI costs, with whose key, as it comes back: the spending's line adds it up. */
export function watchCost(listener: (apiKey: string, label: string, dollars: number) => void) {
	costListeners.add(listener);
	return () => void costListeners.delete(listener);
}

/** Billed even when the answer is no good (a reasoning model that ran out of tokens). */
export function noteCost(apiKey: string, label: string, body: { usage?: Usage } | null) {
	const cost = body?.usage?.cost;
	if (typeof cost === 'number' && cost > 0)
		for (const listener of costListeners) listener(apiKey, label, cost);
}

export async function completeJson<T>(request: {
	apiKey: string;
	/** What it is for, for the spending's line: e.g. «Leer un ticket». */
	label: string;
	system: string;
	prompt: string | ContentPart[];
	/** Name of the schema, e.g. `recipe`. */
	name: string;
	schema: Record<string, unknown>;
	model?: string;
	timeoutMs?: number;
	/** Longest answer, in tokens: without it OpenRouter reserves credit for the model's longest. */
	maxTokens?: number;
}): Promise<T> {
	const res = await send(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${request.apiKey}`,
				'Content-Type': 'application/json',
				'X-OpenRouter-Title': 'Seilide'
			},
			body: JSON.stringify({
				model: request.model ?? DEFAULT_MODEL,
				messages: [
					{ role: 'system', content: request.system },
					{ role: 'user', content: request.prompt }
				],
				max_tokens: request.maxTokens ?? 16_384,
				response_format: {
					type: 'json_schema',
					json_schema: { name: request.name, strict: true, schema: request.schema }
				},
				// Only providers that honour the schema.
				provider: { require_parameters: true }
			}),
			signal: AbortSignal.timeout(request.timeoutMs ?? 60_000)
		})
	);
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res.status, body);
	noteCost(request.apiKey, request.label, body);
	// Errors once the provider has started answering come with a 200, inside the choice.
	const choice = body?.choices?.[0];
	const content = choice?.message?.content;
	if (typeof content !== 'string' || !content.trim())
		throw new Error(
			`OpenRouter: respuesta vacía${choice?.error?.message ? `: ${choice.error.message}` : ''}`
		);
	if (choice.finish_reason === 'length')
		throw new Error('OpenRouter: la respuesta se cortó por larga');
	return JSON.parse(content) as T;
}

/**
 * Our words for OpenRouter's no. A refused key or a 402, said in ours (ai-block.ts tells the 402s
 * apart, and logs theirs): the rest, theirs.
 */
function refused(status: number, body: { error?: { message?: string } } | null) {
	const words = refusalWords(status, body?.error?.message);
	return new Error(words ?? `OpenRouter: ${body?.error?.message ?? status}`);
}

/**
 * What the voice says when it fails: our own words as they are (no credit, a refused key…), and
 * OpenRouter's raw ones, in English, never read aloud; they stay in the log.
 */
export const sayableError = (message: string) =>
	message.startsWith('OpenRouter:')
		? 'La IA no ha podido contestar ahora. Prueba otra vez.'
		: message;

/** OpenRouter found no provider for the model that takes this `tool_choice`. */
export const toolChoiceRefused = (status: number, body: { error?: { message?: string } } | null) =>
	status === 404 && /tool_choice/.test(body?.error?.message ?? '');

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

/** What a turn cost, in tokens. */
export interface Usage {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	cost?: number;
}

const headers = (apiKey: string) => ({
	Authorization: `Bearer ${apiKey}`,
	'Content-Type': 'application/json',
	'X-OpenRouter-Title': 'Seilide'
});

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
			console.warn('[ia] No se pudo leer qué modelos dejan de pensar', String(error));
			thinkingOptional = undefined;
			return new Set<string>();
		});
	return (await thinkingOptional).has(model);
}

type ToolChatRequest = {
	apiKey: string;
	/** As in `completeJson`. */
	label: string;
	model: string;
	/**
	 * Asked when `model` fails for any reason but the key or the credit (its providers gone, the
	 * model retired, the service down): another company's, so that both do not fail together.
	 */
	fallbackModel?: string;
	messages: ToolChatMessage[];
	tools: Tool[];
	timeoutMs?: number;
	/** False, without thinking first when the model allows it: the voice, where each second shows. */
	think?: boolean;
	/** «required»: it must call a tool, never answer with text (the voice ends with its `answer`). */
	toolChoice?: 'auto' | 'required';
};

export type ToolChatAnswer = {
	content: string | null;
	toolCalls: ToolCall[];
	usage: Usage | null;
	/** Why the fallback answered instead of `model`; null if `model` did. */
	fellBack: string | null;
};

/**
 * One turn of a conversation with tools (jellycartoon's, for the voice): the model answers with
 * text, or with the tools it wants called. The caller runs them, adds their results as `tool`
 * messages and asks again. With `fallbackModel`, a second try when `model` fails.
 */
export async function chatWithTools(request: ToolChatRequest): Promise<ToolChatAnswer> {
	try {
		return { ...(await chatOnce(request)), fellBack: null };
	} catch (error) {
		const { fallbackModel } = request;
		if (
			!fallbackModel ||
			fallbackModel === request.model ||
			(error instanceof Error && accountProblem(error.message))
		)
			throw error;
		const why = error instanceof Error ? error.message : String(error);
		console.warn(`[ia] ${request.model} falló; contesta ${fallbackModel}`, { why });
		return { ...(await chatOnce({ ...request, model: fallbackModel })), fellBack: why };
	}
}

async function chatOnce(
	request: ToolChatRequest
): Promise<{ content: string | null; toolCalls: ToolCall[]; usage: Usage | null }> {
	const noThinking = request.think === false && (await canSkipThinking(request.model));
	const ask = (toolChoice: typeof request.toolChoice) =>
		send(request.apiKey, () =>
			fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: headers(request.apiKey),
				body: JSON.stringify({
					model: request.model,
					messages: request.messages,
					tools: request.tools,
					...(toolChoice && { tool_choice: toolChoice }),
					// Short answers here, but room for a model that reasons.
					max_tokens: 4_096,
					...(noThinking && { reasoning: { effort: 'none' } }),
					// Only providers that take tools.
					provider: { require_parameters: true }
					// No caching of its own: the caller marks what does not change (a `TextPart`).
				}),
				signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
			})
		);
	let res = await ask(request.toolChoice);
	let body = await res.json().catch(() => null);
	// No provider of the model that says it takes `tool_choice` (Haiku 5.5's, since 2026-10-29):
	// again without it. The caller copes with text instead of a tool.
	if (request.toolChoice && toolChoiceRefused(res.status, body)) {
		res = await ask(undefined);
		body = await res.json().catch(() => null);
	}
	if (!res.ok) throw refused(res.status, body);
	noteCost(request.apiKey, request.label, body);
	const choice = body?.choices?.[0];
	const message = choice?.message;
	if (!message) {
		if (Number(choice?.error?.code) === 402) {
			console.warn('[ia] OpenRouter dice 402:', choice.error.message ?? '(sin mensaje)');
			const error = refused(402, { error: choice.error });
			noteRefusal(request.apiKey, error.message);
			throw error;
		}
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
 * A question answered with the web (#243, the voice's `web_search`), through OpenRouter's web plugin:
 * https://openrouter.ai/docs/guides/features/plugins/web-search. Its words, short; about a cent
 * each and some seconds more.
 */
export async function askWeb(request: {
	apiKey: string;
	model: string;
	system: string;
	prompt: string;
	label: string;
	timeoutMs?: number;
}) {
	const res = await send(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: headers(request.apiKey),
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
		})
	);
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res.status, body);
	noteCost(request.apiKey, request.label, body);
	const content = body?.choices?.[0]?.message?.content;
	if (typeof content !== 'string' || !content.trim())
		throw new Error(`OpenRouter no ha contestado (${request.label})`);
	return content.trim();
}

/**
 * The cost in a streamed answer: OpenRouter sends the usage in its last event
 * (https://openrouter.ai/docs/api/reference/streaming), `data: {...}` lines ending in `[DONE]`.
 */
export function usageOfStream(text: string): Usage | undefined {
	let usage: Usage | undefined;
	for (const line of text.split('\n')) {
		if (!line.startsWith('data:')) continue;
		const data = line.slice(5).trim();
		if (!data || data === '[DONE]') continue;
		try {
			usage = JSON.parse(data).usage ?? usage;
		} catch {
			// A comment or a broken line: not the usage.
		}
	}
	return usage;
}

/**
 * OpenRouter's refusal to an app's request (#284), in OpenAI's shape, so that the app's client reads
 * it; a key OpenRouter refuses is not the app's fault (not a 401).
 */
async function refusedAnswer(res: Response) {
	const body = await res.json().catch(() => null);
	return Response.json(
		{ error: { message: refused(res.status, body).message, code: res.status } },
		{ status: res.status === 401 ? 502 : res.status }
	);
}

/** As `send`, for an app: its family's AI stopped, a no as OpenRouter's, for `refusedAnswer`. */
const sendForApp = (apiKey: string, fetchIt: () => Promise<Response>) =>
	send(apiKey, fetchIt).catch((error) => {
		if (!(error instanceof AiBlocked)) throw error;
		const status = error.message === BAD_KEY ? 401 : 402;
		return Response.json({ error: { message: error.message } }, { status });
	});

/**
 * An app's request (#284, /api/ia), to OpenRouter as it came, with its family's key; its answer back
 * as it comes, streamed or not, and its cost noted; refused, as `refusedAnswer`.
 */
export async function forwardChat(request: {
	apiKey: string;
	label: string;
	body: Record<string, unknown>;
	signal: AbortSignal;
}): Promise<Response> {
	const res = await sendForApp(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: { ...headers(request.apiKey), 'X-OpenRouter-Title': request.label },
			body: JSON.stringify(request.body),
			signal: request.signal
		})
	);
	if (!res.ok) return refusedAnswer(res);
	if (!request.body.stream || !res.body) {
		const body = await res.json();
		noteCost(request.apiKey, request.label, body);
		return Response.json(body);
	}
	const [toApp, toCount] = res.body.tee();
	void new Response(toCount)
		.text()
		.then((text) => noteCost(request.apiKey, request.label, { usage: usageOfStream(text) }))
		.catch(() => {
			// Cut short by the app: what was spent is not known.
		});
	return new Response(toApp, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
}

/**
 * An app's speech (#284, /api/ia: Langua reads aloud), to OpenRouter's
 * (https://openrouter.ai/docs/guides/overview/multimodal/tts) as it came, with its family's key;
 * the audio back as it comes, with its type (Gemini's, raw PCM: `audio/pcm;rate=24000`). Its cost
 * is not in the answer: OpenRouter's own figures for the key count it.
 */
export async function forwardSpeech(request: {
	apiKey: string;
	label: string;
	body: Record<string, unknown>;
	signal: AbortSignal;
}): Promise<Response> {
	const res = await sendForApp(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/audio/speech', {
			method: 'POST',
			headers: { ...headers(request.apiKey), 'X-OpenRouter-Title': request.label },
			body: JSON.stringify(request.body),
			signal: request.signal
		})
	);
	if (!res.ok) return refusedAnswer(res);
	return new Response(res.body, {
		headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream' }
	});
}

/**
 * Who hears what was said when the family has no house (whose Whisper does it otherwise): right in
 * Spanish where Whisper's turbo invented words, under a second and about a hundredth of a cent an
 * order (tried on 2026-10-29 with a satellite's).
 */
export const TRANSCRIBE_MODEL = 'openai/gpt-4o-mini-transcribe';

/** The recording's format, as OpenRouter names it, from its type; null, one it does not take. */
export function audioFormat(type: string) {
	const mime = type.split(';')[0]!.trim().toLowerCase();
	const formats: Record<string, string> = {
		'audio/webm': 'webm',
		'audio/ogg': 'ogg',
		'audio/mp4': 'm4a',
		'audio/x-m4a': 'm4a',
		'audio/aac': 'aac',
		'audio/mpeg': 'mp3',
		'audio/wav': 'wav',
		'audio/x-wav': 'wav',
		'audio/flac': 'flac'
	};
	return formats[mime] ?? null;
}

/**
 * What was said, by OpenRouter's speech to text:
 * https://openrouter.ai/docs/guides/overview/multimodal/stt. Throws, said for a person.
 */
export async function transcribe(request: {
	apiKey: string;
	audio: ArrayBuffer;
	format: string;
	timeoutMs?: number;
}) {
	const res = await send(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
			method: 'POST',
			headers: headers(request.apiKey),
			body: JSON.stringify({
				model: TRANSCRIBE_MODEL,
				language: 'es',
				input_audio: { data: Buffer.from(request.audio).toString('base64'), format: request.format }
			}),
			signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
		})
	);
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res.status, body);
	noteCost(request.apiKey, 'Voz: oír', body);
	return typeof body?.text === 'string' ? body.text.trim() : '';
}

/**
 * `input` read aloud (https://openrouter.ai/docs/guides/overview/multimodal/tts), as raw PCM: 16-bit,
 * mono, at `rate` (Gemini's speech models give only that), as the house's (its openrouter.ts): for
 * the satellites Seilide serves (#296). `instructions` say how, without being read. Throws, said for
 * a person.
 */
export async function speech(request: {
	apiKey: string;
	model: string;
	voice: string;
	input: string;
	instructions?: string;
	timeoutMs?: number;
}): Promise<{ pcm: Uint8Array; rate: number }> {
	const res = await send(request.apiKey, () =>
		fetch('https://openrouter.ai/api/v1/audio/speech', {
			method: 'POST',
			headers: headers(request.apiKey),
			body: JSON.stringify({
				model: request.model,
				voice: request.voice,
				input: request.input,
				...(request.instructions && { instructions: request.instructions }),
				response_format: 'pcm'
			}),
			signal: AbortSignal.timeout(request.timeoutMs ?? 60_000)
		})
	);
	if (!res.ok) throw refused(res.status, await res.json().catch(() => null));
	// E.g. `audio/pcm;rate=24000;channels=1`.
	const rate = Number(/rate=(\d+)/.exec(res.headers.get('content-type') ?? '')?.[1]) || 24_000;
	return { pcm: new Uint8Array(await res.arrayBuffer()), rate };
}
