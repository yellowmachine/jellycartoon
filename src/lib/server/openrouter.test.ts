import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('#lib/server/app-settings.ts', () => ({ openRouterConfig: async () => ({}) }));
const { streamChat } = await import('./openrouter.ts');

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
		globalThis.fetch = (async () =>
			Response.json(
				{ error: { message: 'Invalid model' } },
				{ status: 400 }
			)) as unknown as typeof fetch;
		await expect(collect()).rejects.toThrow('OpenRouter: Invalid model');
	});
});
