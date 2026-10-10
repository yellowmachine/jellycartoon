import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ask, clearChat, stopAnswer } from '#lib/server/cinema/chat.ts';
import { log } from '#lib/server/log.ts';

const MAX_QUESTION = 2000;

/**
 * A question about the film. The answer comes as it is written, one JSON per line:
 * `{"text"}` pieces, `{"sources"}` when the web was searched, and `{"error"}` if it fails.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const question = typeof body?.question === 'string' ? body.question.trim() : '';
	if (!question) error(400, 'Escribe una pregunta');
	if (question.length > MAX_QUESTION) error(400, 'La pregunta es demasiado larga');

	const movieId = Number(params.id);
	const encoder = new TextEncoder();
	let open = true;
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			// If the page was closed, the answer goes on: it is saved and shown the next time.
			const send = (event: object) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false;
				}
			};
			try {
				for await (const event of ask({ userId: locals.user!.id, movieId, question })) send(event);
			} catch (err) {
				log.warn('cine', 'La IA no pudo responder sobre una película', { movieId, error: err });
				send({ error: err instanceof Error ? err.message : String(err) });
			}
			if (open) controller.close();
		},
		cancel() {
			open = false;
		}
	});
	return new Response(stream, {
		headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' }
	});
};

/** «Parar»: stops the answer being written; what it said so far is kept. */
export const PATCH: RequestHandler = async ({ params, locals }) => {
	await stopAnswer(locals.user!.id, Number(params.id));
	return new Response(null, { status: 204 });
};

/** Starts the conversation over. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	await stopAnswer(locals.user!.id, Number(params.id));
	await clearChat(locals.user!.id, Number(params.id));
	return new Response(null, { status: 204 });
};
