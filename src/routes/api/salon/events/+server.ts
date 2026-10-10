import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mpvEnabled, watchRemote } from '#lib/server/cinema/mpv.ts';

/**
 * What mpv is doing, live, as Server-Sent Events: one `data:` with the whole state on every change.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export const GET: RequestHandler = ({ request }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado');

	const encoder = new TextEncoder();
	let stop = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const send = (text: string) => {
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					// Already closed.
				}
			};
			const unwatch = watchRemote((state) => send(`data: ${JSON.stringify(state)}\n\n`));
			// A comment now and then keeps proxies (Caddy) from closing an idle connection.
			const keepAlive = setInterval(() => send(': ping\n\n'), 25_000);
			stop = () => {
				unwatch();
				clearInterval(keepAlive);
			};
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					controller.close();
				} catch {
					// Already closed.
				}
			});
		},
		cancel: () => stop()
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
