/**
 * OpenRouter (https://openrouter.ai), with the family's own key (family-settings.ts): an answer as
 * JSON to a schema, as jellycartoon's `completeJson`. Each request's cost goes to the spending's
 * line (#193, ai-spend.ts).
 */

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
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
			'Content-Type': 'application/json',
			'X-OpenRouter-Title': 'Nube'
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
	});
	const body = await res.json().catch(() => null);
	if (res.status === 401) throw new Error('OpenRouter no acepta la clave: cámbiala en Ajustes');
	if (res.status === 402) throw new Error('No queda saldo en OpenRouter');
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.status}`);
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

/** Why OpenRouter said no, in words: the voice reads it aloud. */
export const NO_CREDIT = 'No queda saldo en OpenRouter';

function refused(status: number, body: { error?: { message?: string } } | null) {
	if (status === 401) return new Error('OpenRouter no acepta la clave: cámbiala en Ajustes');
	if (status === 402) return new Error(NO_CREDIT);
	return new Error(`OpenRouter: ${body?.error?.message ?? status}`);
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
	'X-OpenRouter-Title': 'Nube'
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

/**
 * One turn of a conversation with tools (jellycartoon's, for the voice): the model answers with
 * text, or with the tools it wants called. The caller runs them, adds their results as `tool`
 * messages and asks again.
 */
export async function chatWithTools(request: {
	apiKey: string;
	/** As in `completeJson`. */
	label: string;
	model: string;
	messages: ToolChatMessage[];
	tools: Tool[];
	timeoutMs?: number;
	/** False, without thinking first when the model allows it: the voice, where each second shows. */
	think?: boolean;
	/** «required»: it must call a tool, never answer with text (the voice ends with its `answer`). */
	toolChoice?: 'auto' | 'required';
}): Promise<{ content: string | null; toolCalls: ToolCall[]; usage: Usage | null }> {
	const noThinking = request.think === false && (await canSkipThinking(request.model));
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: headers(request.apiKey),
		body: JSON.stringify({
			model: request.model,
			messages: request.messages,
			tools: request.tools,
			...(request.toolChoice && { tool_choice: request.toolChoice }),
			// Short answers here, but room for a model that reasons.
			max_tokens: 4_096,
			...(noThinking && { reasoning: { effort: 'none' } }),
			// Only providers that take tools.
			provider: { require_parameters: true }
			// No caching of its own: the caller marks what does not change (a `TextPart`).
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw refused(res.status, body);
	noteCost(request.apiKey, request.label, body);
	const choice = body?.choices?.[0];
	const message = choice?.message;
	if (!message) {
		if (Number(choice?.error?.code) === 402) throw new Error(NO_CREDIT);
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
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
	});
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
 * An app's request (#284, /api/ia), to OpenRouter as it came, with its family's key; its answer back
 * as it comes, streamed or not, and its cost noted. Refused keys and errors, in OpenAI's shape, so
 * that the app's client reads them; a key OpenRouter refuses is not the app's fault (not a 401).
 */
export async function forwardChat(request: {
	apiKey: string;
	label: string;
	body: Record<string, unknown>;
	signal: AbortSignal;
}): Promise<Response> {
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { ...headers(request.apiKey), 'X-OpenRouter-Title': request.label },
		body: JSON.stringify(request.body),
		signal: request.signal
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		const status = res.status === 401 ? 502 : res.status;
		return Response.json(
			{ error: { message: refused(res.status, body).message, code: res.status } },
			{ status }
		);
	}
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
