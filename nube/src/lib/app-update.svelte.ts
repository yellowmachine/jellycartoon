import { updated } from '$app/state';
import { mayTry } from '#lib/app-update.ts';

/**
 * A new version of the app (#579), taken by itself, without asking: SvelteKit says there is one
 * (`updated`, checked on the server's answers, when the page is shown again and every hour:
 * https://svelte.dev/docs/kit/configuration#version), or the browser has the new service worker
 * waiting. The page says when (app-update.ts): it tells the waiting worker to take over
 * (skipWaiting, the documented way: https://web.dev/articles/service-worker-lifecycle#skip_the_waiting_phase)
 * and loads itself again, both at once: the new worker drops the old version's code from its
 * cache, and a page still on the old one would miss it.
 */

const TRIED_KEY = 'version-nueva-intentada';
/** Installing the new version (its code, cached) can take a while on a slow line. */
const INSTALL_MS = 60_000;
const TAKE_OVER_MS = 5_000;

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The worker, once installed (waiting); null if it fails or takes too long. */
function installed(worker: ServiceWorker | null) {
	if (!worker) return Promise.resolve(null);
	if (worker.state === 'installed') return Promise.resolve(worker);
	return Promise.race([
		new Promise<ServiceWorker | null>((done) =>
			worker.addEventListener('statechange', () => {
				if (worker.state === 'installed') done(worker);
				else if (worker.state === 'redundant' || worker.state === 'activated') done(null);
			})
		),
		wait(INSTALL_MS).then(() => null)
	]);
}

class AppUpdate {
	/** The browser has the new service worker installed and waiting. */
	#waiting = $state(false);
	#watching = false;
	#busy = false;

	/** There is a new version to take. */
	get pending() {
		return updated.current || this.#waiting;
	}

	/** Not tried a moment ago without it working (app-update.ts, RETRY_MS). */
	get mayTry() {
		try {
			const at = sessionStorage.getItem(TRIED_KEY);
			return mayTry(at === null ? null : Number(at), Date.now());
		} catch {
			return true;
		}
	}

	/** Whether the browser already has the new worker waiting, now and when it gets one. */
	async watch() {
		if (this.#watching || !('serviceWorker' in navigator)) return;
		this.#watching = true;
		const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
		if (!registration) return;
		const check = () =>
			(this.#waiting = Boolean(registration.waiting && navigator.serviceWorker.controller));
		check();
		registration.addEventListener('updatefound', () => {
			void installed(registration.installing).then(check);
		});
	}

	/** The new version, now: the worker takes over and the page loads `to` (by default, itself). */
	async take(to = location.href) {
		if (this.#busy) return;
		this.#busy = true;
		try {
			sessionStorage.setItem(TRIED_KEY, String(Date.now()));
		} catch {
			// A private window: tried again on the next chance.
		}
		try {
			const registration = await navigator.serviceWorker?.getRegistration();
			if (registration) {
				// The new worker, if the browser had not got it yet.
				if (!registration.waiting) await registration.update().catch(() => {});
				const worker = registration.waiting ?? (await installed(registration.installing));
				if (worker && navigator.serviceWorker.controller) {
					const tookOver = new Promise<void>((done) =>
						navigator.serviceWorker.addEventListener('controllerchange', () => done(), {
							once: true
						})
					);
					worker.postMessage({ type: 'skip-waiting' });
					await Promise.race([tookOver, wait(TAKE_OVER_MS)]);
				}
			}
		} catch {
			// Without the worker the page loads anyway: the new version from the server.
		}
		if (to === location.href) location.reload();
		else location.href = to;
	}
}

export const appUpdate = new AppUpdate();
