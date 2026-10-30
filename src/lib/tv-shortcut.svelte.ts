import { goto } from '$app/navigation';
import { shownDeviceName } from 'comun/device-name.svelte.ts';

/**
 * A TV shortcut's site (#327), in a window of its own over the TV view: the remote's power button
 * (deploy/kwin/jellycartoon-mando) goes from one to the other. In the TV view's own window, the
 * remote's Back never came back: the sites redirect as they open, and Back fell on a page in
 * between that went forward again. The TV view stays open behind, and while the window is open and
 * in front, says so every few seconds (/api/accesos/[id]): a child's time, as a live channel's;
 * out of it, the window is closed and «/descanso» says why.
 */

/** The window's name: the same one again, never two; and found by it after a reload. */
const WINDOW = 'acceso';
const STEP_MS = 10_000;
/** What is open, for a reload of the TV view (an update of the app) to go on counting. */
const SAVED = 'acceso-abierto';

interface Open {
	id: number;
	name: string;
	/** Seconds in front so far, the position sent. */
	seconds: number;
}

function report(id: number, positionSec: number) {
	return fetch(`/api/accesos/${id}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ positionSec, device: shownDeviceName(true) })
	}).catch(() => null);
}

function save(open: Open | null) {
	try {
		if (open) sessionStorage.setItem(SAVED, JSON.stringify(open));
		else sessionStorage.removeItem(SAVED);
	} catch {
		// Without storage, a reload only stops counting.
	}
}

class TvShortcutWindow {
	/** The one open, if any. */
	open = $state<{ id: number; name: string } | null>(null);
	/** Why it did not open. */
	problem = $state<string | null>(null);
	#window: Window | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;

	/** Opened from its tile: unless a child watching is out of its time. */
	async start(shortcut: { id: number; name: string }) {
		this.problem = null;
		const res = await report(shortcut.id, 0);
		if (res?.status === 403) return void goto('/descanso');
		if (!res?.ok) {
			this.problem = `No se pudo abrir ${shortcut.name}`;
			return;
		}
		const { url } = (await res.json()) as { url: string };
		const w = window.open(url, WINDOW, 'popup');
		if (!w) {
			this.problem = 'El navegador no dejó abrir la ventana: permite las ventanas emergentes aquí.';
			return;
		}
		this.#follow(w, { ...shortcut, seconds: 0 });
	}

	/** Closed from the TV view: «Cerrar …». */
	close() {
		this.#window?.close();
		this.#stop();
	}

	/**
	 * After a reload of the TV view, the window that was open, by its name. Opening that name with
	 * no window makes a blank one, closed at once; the site's, of another origin, cannot be read.
	 */
	recover() {
		let saved: Open | null;
		try {
			saved = JSON.parse(sessionStorage.getItem(SAVED) ?? 'null');
		} catch {
			return;
		}
		if (!saved || this.#window) return;
		const w = window.open('', WINDOW, 'popup');
		if (!w) return save(null);
		try {
			if (w.location.href === 'about:blank') {
				w.close();
				return save(null);
			}
		} catch {
			// The site's: still open.
		}
		this.#follow(w, saved);
	}

	#follow(w: Window, open: Open) {
		clearInterval(this.#timer);
		this.#window = w;
		this.open = { id: open.id, name: open.name };
		save(open);
		let last = Date.now();
		let seconds = open.seconds;
		this.#timer = setInterval(async () => {
			if (w.closed) return this.#stop();
			const now = Date.now();
			// Only while it is in front: by the clock, as the browser slows the timers of a page
			// out of sight.
			if (!document.hasFocus()) seconds += (now - last) / 1000;
			last = now;
			save({ ...open, seconds });
			const res = await report(open.id, seconds);
			if (res?.status === 403) {
				this.close();
				void goto('/descanso');
			}
		}, STEP_MS);
	}

	#stop() {
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.#window = null;
		this.open = null;
		save(null);
	}
}

export const tvShortcutWindow = new TvShortcutWindow();
