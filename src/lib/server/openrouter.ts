import { openRouterConfig } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';

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

/** One line in the Registro for every request to the AI: what it was for, and what it cost. */
function logUsage(
	label: string,
	body: { model?: string; provider?: string; usage?: Usage },
	details?: Record<string, unknown>
) {
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
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	// Errors once the provider has started answering come with a 200, inside the choice:
	// https://openrouter.ai/docs/api/reference/errors-and-debugging
	const choice = body?.choices?.[0];
	const content = choice?.message?.content;
	const provider = body?.provider ? ` (${body.provider})` : '';
	// Billed even when it fails, e.g. a reasoning model that thought until it ran out of tokens.
	if (body?.usage) logUsage(request.label, body, request.details);
	if (typeof content !== 'string' || !content.trim()) {
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
			const body = await res.json().catch(() => null);
			throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
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
				if (event.error) throw new Error(`OpenRouter: ${event.error.message ?? event.error.code}`);
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
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
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
			messages: request.messages,
			tools: request.tools,
			// As in `completeJson`; short answers here, but room for a model that reasons.
			max_tokens: 4_096,
			// Only providers that take tools.
			provider: { require_parameters: true }
			// No caching of its own: the caller marks what does not change (a `TextPart`).
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 30_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	if (body?.usage) logUsage(request.label, body, request.details);
	const choice = body?.choices?.[0];
	const message = choice?.message;
	if (!message) {
		const why = body?.error?.message ?? choice?.error?.message;
		throw new Error(`OpenRouter: respuesta vacía${why ? `: ${why}` : ''}`);
	}
	return {
		content: typeof message.content === 'string' && message.content.trim() ? message.content : null,
		toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : []
	};
}
