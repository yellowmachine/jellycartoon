import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import { fromCloud } from '#lib/server/media-api.ts';

/** One question: a few seconds on the GPU, the first one also loads the model. */
const TIMEOUT_MS = 60_000;
const MAX_TEXT = 8_000;

/**
 * Seilide's AI when OpenRouter does not answer (#331, phase 5: what a Telegram message has worth
 * remembering): its instructions, what to read and the JSON schema of the answer, asked of the
 * house's Ollama (OLLAMA_URL, LABEL_MODEL, the model the episodes are labelled with, already
 * pulled) with its structured outputs (https://docs.ollama.com/capabilities/structured-outputs).
 * Back, the answer as it came. 404 without Ollama; 503 if it does not answer.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	if (!OLLAMA_URL) error(404, 'La casa no tiene Ollama');
	const body = await request.json().catch(() => null);
	const system = typeof body?.system === 'string' ? body.system.slice(0, MAX_TEXT) : '';
	const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, MAX_TEXT) : '';
	const schema = body?.schema;
	if (!system || !prompt || typeof schema !== 'object' || !schema) error(400, 'Petición no válida');
	const res = await fetch(`${OLLAMA_URL.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LABEL_MODEL,
			stream: false,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: prompt }
			],
			format: schema,
			// The most likely answer, not a creative one.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	}).catch((err) => {
		error(503, `No se pudo hablar con Ollama: ${err instanceof Error ? err.message : err}`);
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok) error(503, `Ollama: ${answer?.error ?? res.statusText}`);
	try {
		return json({ answer: JSON.parse(answer?.message?.content ?? '') });
	} catch {
		error(503, 'Ollama no respondió JSON');
	}
};
