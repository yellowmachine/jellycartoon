import { goto } from '$app/navigation';
import { page } from '$app/state';
import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';
import { timers } from '#lib/timers.svelte.ts';
import type { Recipe } from 'comun/recipe.ts';

/**
 * Kitchen mode (#60): the phone on the kitchen wall keeps its screen on, to see the timers and
 * press the microphone without unlocking it. With the browser's Screen Wake Lock:
 * https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API
 * Remembered in this browser; it turns itself off after a while with no timers, not to drain the
 * battery when it is forgotten.
 */

const STORAGE_KEY = 'kitchen-mode';

/**
 * The kitchen's screen (#483): the steps on the left, and on the right its home (/cocina, the
 * recipe), the recipe book or these sections as they are (a series, a channel, the music…), without the site around them: one tap
 * from the steps to the music and back. What plays goes on from one to another. Any other page, the site as usual
 * (with «Volver a la cocina» in the header).
 */
const KITCHEN_PATHS = ['/cocina', '/recetas', '/series', '/watch', '/canales', '/musica', '/radio'];

export const inKitchen = (pathname: string) =>
	KITCHEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

	/**
	 * Into the kitchen's screen. From a tap (`tap`), on a tablet or phone the browser's full screen
	 * too, without its bar: it only allows it from a touch, and an installed app has no bar.
	 * Already in it (the music on the right), it stays where it is.
	 */
	enter(tap = false) {
		if (tap) fullScreen();
		if (!inKitchen(page.url.pathname)) void goto('/cocina');
		return this.on ? Promise.resolve() : this.set(true);
	}

	/** «Salir de la cocina»: off, out of the full screen, and to the home page. What plays goes on. */
	leave() {
		if (document.fullscreenElement === document.documentElement)
			void document.exitFullscreen().catch(() => {});
		void goto('/');
		return this.set(false);
	}

	/** Cooking, by voice or from the recipe book: the kitchen's screen, with the steps. */
	cook(cooked: Recipe, step = 0, tap = false) {
		recipe.start(cooked, step);
		return this.enter(tap);
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

/** Full screen on a touch screen not installed as an app: the tablet on the kitchen's wall. */
function fullScreen() {
	if (!document.fullscreenEnabled || document.fullscreenElement) return;
	if (!matchMedia('(pointer: coarse)').matches) return;
	if (matchMedia('(display-mode: standalone)').matches) return;
	void document.documentElement.requestFullscreen().catch(() => {});
}

export const kitchenMode = new KitchenMode();

/**
 * The video on the kitchen's screen (#483), a series or a channel: paused while a timer rings or
 * the voice listens and answers, and on again after, as the music. By the page's own <video>
 * playing with sound, whichever player it is.
 */
const pausedVideos = new Set<HTMLVideoElement>();

export function pauseKitchenVideo() {
	if (!kitchenMode.on || !inKitchen(location.pathname)) return;
	for (const video of document.querySelectorAll('video'))
		if (!video.paused && !video.ended && !video.muted) {
			video.pause();
			pausedVideos.add(video);
		}
}

export function resumeKitchenVideo() {
	for (const video of pausedVideos) if (video.isConnected) void video.play().catch(() => {});
	pausedVideos.clear();
}
