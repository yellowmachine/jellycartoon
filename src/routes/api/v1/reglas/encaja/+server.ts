import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import { fromCloud } from '#lib/server/media-api.ts';

/** One question: a few seconds on the GPU, the first one also loads the model. */
const TIMEOUT_MS = 30_000;
const MAX_TEXT = 500;

/**
 * Seilide's rules (#331, phase 3), when what happened does not share their words and OpenRouter
 * does not answer: whether «Llegan papá y mamá» is what «cuando vengan mis padres» waits for,
 * asked of the house's Ollama (its OLLAMA_URL and LABEL_MODEL, the model the episodes are
 * labelled with, already pulled), with its structured outputs
 * (https://docs.ollama.com/capabilities/structured-outputs). 404 without Ollama; 503 if it does
 * not answer.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	if (!OLLAMA_URL) error(404, 'La casa no tiene Ollama');
	const body = await request.json().catch(() => null);
	const rule = typeof body?.rule === 'string' ? body.rule.slice(0, MAX_TEXT) : '';
	const item = typeof body?.item === 'string' ? body.item.slice(0, MAX_TEXT) : '';
	const what = typeof body?.what === 'string' ? body.what.slice(0, 40) : 'cosa';
	if (!rule || !item) error(400, 'Falta la regla o lo que ha pasado');
	const res = await fetch(`${OLLAMA_URL.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LABEL_MODEL,
			stream: false,
			messages: [
				{
					role: 'system',
					content:
						'Dices si algo que ha pasado en una familia es lo que espera una de sus reglas. ' +
						'Solo true si es claramente eso (sinónimos, formas de decirlo, quién es quién); si dudas, false. ' +
						'En «porque», muy corto, por qué.'
				},
				{
					role: 'user',
					content: `Regla: «${rule}».\n${what}: «${item}».\n¿Es lo que espera la regla?`
				}
			],
			format: {
				type: 'object',
				properties: { encaja: { type: 'boolean' }, porque: { type: 'string' } },
				required: ['encaja', 'porque']
			},
			// The most likely answer, not a creative one.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	}).catch((err) => {
		error(503, `No se pudo hablar con Ollama: ${err instanceof Error ? err.message : err}`);
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok) error(503, `Ollama: ${answer?.error ?? res.statusText}`);
	let parsed: { encaja?: unknown; porque?: unknown };
	try {
		parsed = JSON.parse(answer?.message?.content ?? '');
	} catch {
		error(503, 'Ollama no respondió JSON');
	}
	return json({
		matches: parsed.encaja === true,
		why: typeof parsed.porque === 'string' ? parsed.porque.slice(0, 200) : ''
	});
};
