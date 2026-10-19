import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';
import { timers } from '#lib/timers.svelte.ts';

/**
 * Kitchen mode (#60): the phone on the kitchen wall keeps its screen on, to see the timers and
 * press the microphone without unlocking it. With the browser's Screen Wake Lock:
 * https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API
 * Remembered in this browser; it turns itself off after a while with no timers, not to drain the
 * battery when it is forgotten.
 */

const STORAGE_KEY = 'kitchen-mode';
/** On this long, with no timer running or waiting, it turns itself off. */
const AUTO_OFF_MS = 3 * 3600_000;
const CHECK_EVERY_MS = 60_000;

class KitchenMode {
	on = $state(false);
	/** Why the screen cannot be kept on here, if it cannot. */
	problem = $state<string | null>(null);

	#lock: WakeLockSentinel | null = null;
	/** When it was turned on, or last had timers: what the auto-off counts from. */
	#activeAt = 0;
	#check: ReturnType<typeof setInterval> | undefined;
	#loaded = false;

	/** As it was left in this browser; the lock asked for again whenever the page is shown. */
	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		document.addEventListener('visibilitychange', () => {
			// The browser lets the lock go when the page is hidden (another app, screen off).
			if (this.on && document.visibilityState === 'visible') void this.#acquire();
		});
		try {
			const at = Number(localStorage.getItem(STORAGE_KEY));
			if (at && Date.now() - at < AUTO_OFF_MS) void this.set(true, at);
			// Gone off while the page was closed: its session too.
			else kitchenLog.clear();
		} catch {
			// Private windows.
		}
	}

	async set(value: boolean, since = Date.now()) {
		this.on = value;
		this.problem = null;
		// What is said is kept while it is on; off, the session is over.
		kitchenLog.active = value;
		if (!value) kitchenLog.clear();
		clearInterval(this.#check);
		if (!value) {
			await this.#lock?.release().catch(() => {});
			this.#lock = null;
			this.#remember(null);
			return;
		}
		this.#activeAt = since;
		this.#remember(since);
		this.#check = setInterval(() => this.#autoOff(), CHECK_EVERY_MS);
		await this.#acquire();
	}

	#remember(since: number | null) {
		try {
			if (since === null) localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, String(since));
		} catch {
			// Same.
		}
	}

	async #acquire() {
		if (!('wakeLock' in navigator)) {
			this.problem = 'Este navegador no puede mantener la pantalla encendida.';
			return;
		}
		if (this.#lock && !this.#lock.released) return;
		try {
			this.#lock = await navigator.wakeLock.request('screen');
		} catch {
			// Not visible, or the battery saver says no: asked again when the page is shown.
			if (document.visibilityState === 'visible')
				this.problem = 'No se pudo mantener la pantalla encendida (¿ahorro de batería?).';
		}
	}

	/** Timers and a recipe being cooked keep it on; without them for AUTO_OFF_MS, off. */
	#autoOff() {
		if (timers.list.length || timers.prepared.length || timers.ringing.length || recipe.current) {
			this.#activeAt = Date.now();
			this.#remember(this.#activeAt);
		} else if (Date.now() - this.#activeAt > AUTO_OFF_MS) void this.set(false);
	}
}

export const kitchenMode = new KitchenMode();
