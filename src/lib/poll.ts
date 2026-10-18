/**
 * Calls `refresh` every `ms` while the tab is shown, never two at once: the next waits for the
 * last to finish. Hidden, it stops; shown again, it refreshes at once and goes on. Returns the stop,
 * for an `$effect`'s cleanup. https://developer.mozilla.org/docs/Web/API/Page_Visibility_API
 */
export function poll(refresh: () => unknown, ms: number, doc: Document = document) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running = false;
	let stopped = false;

	function schedule() {
		clearTimeout(timer);
		if (!stopped && !doc.hidden) timer = setTimeout(tick, ms);
	}

	async function tick() {
		if (running) return;
		running = true;
		try {
			await refresh();
		} catch {
			// The next one may work: a refresh is only to follow what is going on.
		} finally {
			running = false;
		}
		schedule();
	}

	function visibilityChanged() {
		if (doc.hidden) clearTimeout(timer);
		else void tick();
	}

	doc.addEventListener('visibilitychange', visibilityChanged);
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
		doc.removeEventListener('visibilitychange', visibilityChanged);
	};
}
