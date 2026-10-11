import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('#lib/server/app-settings.ts', () => ({
	openRouterConfig: async () => ({ apiKey: 'k', model: 'anthropic/claude-haiku-5.5' })
}));
/** What was written to the Registro. */
const logged: { source: string; message: string }[] = [];
mock.module('#lib/server/log.ts', () => ({
	log: { info: (source: string, message: string) => logged.push({ source, message }) }
}));
const { completeJson, describeUsage, streamChat } = await import('./openrouter.ts');

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

/** OpenRouter answering with these pieces of an SSE stream. */
function answer(pieces: string[], status = 200) {
	let sent: RequestInit | undefined;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		sent = init;
		const body = new ReadableStream({
			start(controller) {
				for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
				controller.close();
			}
		});
		return new Response(body, { status });
	}) as typeof fetch;
	return () => JSON.parse(String(sent!.body));
}

const chunk = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

async function collect(web = false, model = 'anthropic/claude-sonnet-5.5') {
	const events = [];
	for await (const event of streamChat({
		apiKey: 'k',
		model,
		messages: [{ role: 'user', content: 'hola' }],
		web,
		label: 'Conversación',
		signal: new AbortController().signal
	}))
		events.push(event);
	return events;
}

describe('streamChat', () => {
	test('text pieces, skipping keep-alives, also when a line arrives split', async () => {
		const full = chunk({ content: 'mundo' });
		answer([
			': OPENROUTER PROCESSING\n\n',
			chunk({ content: 'Hola ' }),
			full.slice(0, 20),
			full.slice(20),
			'data: [DONE]\n\n'
		]);
		expect(await collect()).toEqual([{ text: 'Hola ' }, { text: 'mundo' }]);
	});

	test('web sources, each page once', async () => {
		const sent = answer([
			chunk({ content: 'Sí.' }),
			chunk({
				annotations: [
					{ type: 'url_citation', url_citation: { url: 'https://a.org/x', title: 'A' } },
					{ type: 'url_citation', url_citation: { url: 'https://b.org/y' } }
				]
			}),
			chunk({
				annotations: [
					{ type: 'url_citation', url_citation: { url: 'https://a.org/x', title: 'A' } }
				]
			}),
			'data: [DONE]\n\n'
		]);
		expect(await collect(true)).toEqual([
			{ text: 'Sí.' },
			{
				sources: [
					{ url: 'https://a.org/x', title: 'A' },
					{ url: 'https://b.org/y', title: 'b.org' }
				]
			}
		]);
		expect(sent().plugins).toEqual([{ id: 'web' }]);
		expect(sent().cache_control).toEqual({ type: 'ephemeral' });
	});

	test('no web plugin nor Anthropic cache unless they apply', async () => {
		const sent = answer(['data: [DONE]\n\n']);
		await collect(false, 'openai/gpt-5.2');
		expect(sent().plugins).toBeUndefined();
		expect(sent().cache_control).toBeUndefined();
		expect(sent().stream).toBe(true);
	});

	test('an error inside the stream', async () => {
		answer([
			chunk({ content: 'Empie' }),
			`data: ${JSON.stringify({ error: { code: 'server_error', message: 'Provider disconnected' } })}\n\n`
		]);
		await expect(collect()).rejects.toThrow('OpenRouter: Provider disconnected');
	});

	test('an error before answering', async () => {
		globalThis.fetch = (async (_url: string) =>
			Response.json(
				{ error: { message: 'Invalid model' } },
				{ status: 400 }
			)) as unknown as typeof fetch;
		await expect(collect()).rejects.toThrow('OpenRouter: Invalid model');
	});
});

describe('completeJson', () => {
	const ask = (maxTokens?: number) =>
		completeJson<{ ok: boolean }>({
			system: 's',
			prompt: 'p',
			name: 'test',
			label: 'Prueba',
			schema: {},
			maxTokens
		});

	test('limits the answer, so the key is not asked for credit for the longest one', async () => {
		let sent: RequestInit | undefined;
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			sent = init;
			return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
		}) as typeof fetch;
		expect(await ask()).toEqual({ ok: true });
		expect(JSON.parse(String(sent!.body)).max_tokens).toBe(4096);
		await ask(8192);
		expect(JSON.parse(String(sent!.body)).max_tokens).toBe(8192);
	});

	test('says why an answer came empty', async () => {
		globalThis.fetch = (async (_url: string) =>
			Response.json({
				provider: 'Google',
				choices: [
					{
						message: { content: null },
						finish_reason: 'content_filter',
						native_finish_reason: 'SAFETY'
					}
				]
			})) as typeof fetch;
		await expect(ask()).rejects.toThrow('OpenRouter: respuesta vacía (Google): terminó con SAFETY');

		globalThis.fetch = (async (_url: string) =>
			Response.json({
				choices: [{ message: { content: '' }, error: { code: 502, message: 'Upstream error' } }]
			})) as typeof fetch;
		await expect(ask()).rejects.toThrow('OpenRouter: respuesta vacía: Upstream error');
	});
});

describe('usage', () => {
	test('is described with tokens, cache and cost', () => {
		expect(
			describeUsage({
				prompt_tokens: 12345,
				completion_tokens: 678,
				cost: 0.02134,
				prompt_tokens_details: { cached_tokens: 10000 }
			})
		).toBe('12.345 + 678 tokens (10.000 de caché), 0,0213 $');
		expect(describeUsage(undefined)).toBe('sin datos de uso');
	});

	test('of every request goes to the Registro', async () => {
		logged.length = 0;
		globalThis.fetch = (async (_url: string) =>
			Response.json({
				choices: [{ message: { content: '{"ok":true}' } }],
				usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.001 }
			})) as typeof fetch;
		await completeJson({ system: 's', prompt: 'p', name: 'test', label: 'Prueba', schema: {} });
		expect(logged).toEqual([{ source: 'ia', message: 'Prueba: 100 + 5 tokens, 0,001 $' }]);

		logged.length = 0;
		answer([
			chunk({ content: 'Hola' }),
			`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 1, cost: 0.0005 } })}\n\n`,
			'data: [DONE]\n\n'
		]);
		await collect();
		expect(logged).toEqual([{ source: 'ia', message: 'Conversación: 50 + 1 tokens, 0,0005 $' }]);
	});
});
