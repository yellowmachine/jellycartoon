import { afterEach, describe, expect, mock, test } from 'bun:test';

/** The app's settings, in memory: where the credit's running out is kept. */
const settings = new Map<string, string>();
mock.module('#lib/server/app-settings.ts', () => ({
	openRouterConfig: async () => ({ apiKey: 'k', model: 'anthropic/claude-haiku-5.5' }),
	openRouterManagementKey: async () => null,
	getAppSetting: async (key: string) => settings.get(key) ?? null,
	setAppSetting: async (key: string, value: string | null) =>
		void (value === null ? settings.delete(key) : settings.set(key, value))
}));
/** What was written to the Registro. */
const logged: { source: string; message: string }[] = [];
mock.module('#lib/server/log.ts', () => ({
	log: {
		info: (source: string, message: string) => logged.push({ source, message }),
		warn: (source: string, message: string) => logged.push({ source, message })
	}
}));
const {
	completeJson,
	creditRecharged,
	creditRunOutAt,
	describeUsage,
	NO_CREDIT,
	openRouterAuth,
	streamChat
} = await import('./openrouter.ts');

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
		expect(JSON.parse(String(sent!.body)).max_tokens).toBe(16_384);
		await ask(32_768);
		expect(JSON.parse(String(sent!.body)).max_tokens).toBe(32_768);
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

		globalThis.fetch = (async (_url: string) =>
			Response.json({
				provider: 'Azure',
				choices: [
					{
						message: { content: null },
						finish_reason: 'length',
						native_finish_reason: 'max_tokens'
					}
				]
			})) as typeof fetch;
		await expect(ask()).rejects.toThrow(
			'OpenRouter: respuesta vacía (Azure): se quedó sin tokens (razonando) antes de responder'
		);
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

describe('no credit left', () => {
	const ask = () =>
		completeJson({ system: 's', prompt: 'p', name: 'x', label: 'Prueba', schema: {} });
	const refuse = (error: object) =>
		(globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error }), { status: 402 })) as unknown as typeof fetch);

	test('a 402 is said for a person, and nothing else is asked until «Ya he recargado»', async () => {
		refuse({ code: 402, message: 'Insufficient credits' });
		await expect(ask()).rejects.toThrow(NO_CREDIT);
		expect(await creditRunOutAt()).toBeInstanceOf(Date);
		expect(settings.get('openrouter_credit_out')).toBeString();

		let asked = 0;
		globalThis.fetch = (async () => {
			asked++;
			return Response.json({
				choices: [{ message: { content: '{}' } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 }
			});
		}) as unknown as typeof fetch;
		await expect(ask()).rejects.toThrow(NO_CREDIT);
		expect(asked).toBe(0);

		creditRecharged();
		await ask();
		expect(asked).toBe(1);
		expect(await creditRunOutAt()).toBeNull();
		expect(settings.has('openrouter_credit_out')).toBe(false);
	});

	test('not when it only waits for requests already running', async () => {
		refuse({
			code: 402,
			message: 'busy',
			metadata: { limit_source: 'openrouter_in_flight_budget' }
		});
		await expect(ask()).rejects.toThrow('OpenRouter: busy');
		expect(await creditRunOutAt()).toBeNull();
	});

	test('also inside a stream', async () => {
		answer([`data: ${JSON.stringify({ error: { code: 402, message: 'no' } })}\n\n`]);
		await expect(collect()).rejects.toThrow(NO_CREDIT);
		creditRecharged();
	});
});

describe('openRouterAuth', () => {
	test('PKCE S256: the challenge is the verifier hashed, with the way back and a state', async () => {
		const { url, verifier, state } = openRouterAuth('https://casa.example/ajustes/openrouter');
		const link = new URL(url);
		expect(link.origin + link.pathname).toBe('https://openrouter.ai/auth');
		expect(link.searchParams.get('callback_url')).toBe('https://casa.example/ajustes/openrouter');
		expect(link.searchParams.get('code_challenge_method')).toBe('S256');
		expect(link.searchParams.get('state')).toBe(state);
		const hash = new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
		);
		expect(link.searchParams.get('code_challenge')).toBe(Buffer.from(hash).toString('base64url'));
	});
});
