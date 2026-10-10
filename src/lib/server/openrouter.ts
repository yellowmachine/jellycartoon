import { openRouterConfig } from '#lib/server/app-settings.ts';

/**
 * One request to OpenRouter's chat completions API, answered as JSON that follows `schema`
 * (structured outputs): https://openrouter.ai/docs/features/structured-outputs
 */
export async function completeJson<T>(request: {
	system: string;
	prompt: string;
	/** Name of the schema, e.g. `film`. */
	name: string;
	schema: Record<string, unknown>;
}): Promise<T> {
	const { apiKey, model } = await openRouterConfig();
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
			temperature: 0,
			response_format: {
				type: 'json_schema',
				json_schema: { name: request.name, strict: true, schema: request.schema }
			},
			// Only providers that honour the schema.
			provider: { require_parameters: true }
		}),
		signal: AbortSignal.timeout(60_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	const content = body?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new Error('OpenRouter: respuesta vacía');
	return JSON.parse(content) as T;
}

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
export async function* streamChat(request: {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	web: boolean;
	/** Aborting stops the generation (and its billing, with most providers). */
	signal: AbortSignal;
}): AsyncGenerator<ChatEvent> {
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
			...(request.web && { plugins: [{ id: 'web' }] }),
			// The film's articles are long and go with every question: Anthropic caches them only
			// when asked (https://openrouter.ai/docs/guides/best-practices/prompt-caching); the
			// other providers do it by themselves.
			...(request.model.startsWith('anthropic/') && { cache_control: { type: 'ephemeral' } })
		}),
		signal: request.signal
	});
	if (!res.ok || !res.body) {
		const body = await res.json().catch(() => null);
		throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	}

	const seen = new Set<string>();
	let buffer = '';
	for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
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
}
