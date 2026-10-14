/**
 * A state, live, as Server-Sent Events: one `data:` with the whole state on every change.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export function sseResponse<T>(
	request: Request,
	watch: (listener: (state: T) => void) => () => void
) {
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
			const unwatch = watch((state) => send(`data: ${JSON.stringify(state)}\n\n`));
			// A comment now and then keeps proxies (Tailscale Serve) from closing an idle connection.
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
}
