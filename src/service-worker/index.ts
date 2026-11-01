import { version } from '$app/env';
import { self } from '$app/service-worker';

/**
 * The app's service worker: for the adults' notices (Web Push, push.ts on the server), such as a
 * child asking to enter (#141), and for a page of its own when the house does not answer (out of
 * its wifi without the VPN). It caches nothing else: the app works as always without it.
 */

/** «Estás fuera de casa» and its picture, kept on installing: shown without the house. */
const OUTSIDE = '/fuera-de-casa';
const KEPT = [OUTSIDE, '/icon-192.png'];
const CACHE = `fuera-${version}`;
/** A page taking longer than this: is the house there? (out of its wifi, it hangs for long). */
const SLOW_MS = 4000;
/** How long the house has to answer that. */
const PROBE_MS = 2500;

self.addEventListener('install', (event) => {
	// Without it (the house restarting), the app installs anyway: only that page is missing.
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(KEPT))
			.catch(() => {})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

/** The house answers at all (even an error): reachable, just slow. */
const reachable = () =>
	fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(PROBE_MS) }).then(
		() => true,
		() => false
	);

async function outside() {
	return (
		(await caches.match(OUTSIDE)) ??
		new Response('Estás fuera de casa: JellyCartoon solo se abre en su wifi o con la VPN.', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		})
	);
}

/**
 * Opening a page: as always if the house answers. If it cannot be reached, or takes long and does
 * not answer a quick question either, «Estás fuera de casa», which comes back by itself.
 */
async function navigate(request: Request) {
	const page = fetch(request);
	const first = await Promise.race([
		page.then(
			() => 'answered' as const,
			() => 'failed' as const
		),
		new Promise<'slow'>((resolve) => setTimeout(() => resolve('slow'), SLOW_MS))
	]);
	if (first === 'answered') return page;
	if (first === 'slow' && (await reachable())) return page.catch(outside);
	return outside();
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.mode === 'navigate' && request.method === 'GET') event.respondWith(navigate(request));
});

interface PushMessage {
	title: string;
	body: string;
	tag: string;
	url: string;
	sticky?: boolean;
}

self.addEventListener('push', (event) => {
	const message: PushMessage | null = event.data?.json() ?? null;
	if (!message) return;
	event.waitUntil(
		self.registration.showNotification(message.title, {
			body: message.body,
			tag: message.tag,
			icon: '/icon-192.png',
			// The status bar's small icon: Android only takes its shape, so a white silhouette.
			badge: '/badge-96.png',
			requireInteraction: message.sticky ?? false,
			data: { url: message.url }
		})
	);
});

/** Whether the page went there itself: it answers on the channel, if it is awake and listening. */
function wentThere(client: Client, to: string) {
	return new Promise<boolean>((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(false), 1500);
		channel.port1.onmessage = () => {
			clearTimeout(timer);
			resolve(true);
		};
		client.postMessage({ goto: to }, [channel.port2]);
	});
}

/**
 * Touched: the app, at its page. Already open, it goes there itself (the root layout listens), not
 * loaded again: what plays goes on. Asleep in the background, or not listening, it does not answer:
 * then it is taken there, or a new window opens.
 */
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const to: string = event.notification.data?.url ?? '/';
	const url = new URL(to, self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
			if (open) {
				const shown = await open.focus().catch(() => open);
				if (await wentThere(shown, to)) return;
				const taken = await shown.navigate(url).catch(() => null);
				if (taken) return;
			}
			await self.clients.openWindow(url);
		})()
	);
});
