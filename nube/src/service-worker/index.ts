import { self } from '$app/service-worker';
import { SHARED_CACHE, SHARED_KEY } from '#lib/shared-file.ts';

/**
 * The cloud's service worker (#253), as jellycartoon's: for the family's notices (Web Push,
 * push.ts on the server), such as an alarm ringing or the agenda's, and for files shared to the
 * app. It caches nothing else: the app works as always without it.
 *
 * «Compartir → Nube» (the manifest's share_target): a file, a bill's PDF or a photo, waits in the
 * cache for Gastos to take it; a link or a text goes on to /compartido, in its address. The way
 * documented for files, the page cannot read the POST itself:
 * https://developer.chrome.com/docs/capabilities/web-apis/web-share-target#accepting_files
 */
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'POST' || url.pathname !== '/compartido') return;
	event.respondWith(
		(async () => {
			const form = await event.request.formData();
			const file = form.get('archivo');
			if (file instanceof File && file.size) {
				const cache = await caches.open(SHARED_CACHE);
				await cache.put(
					SHARED_KEY,
					new Response(file, {
						headers: {
							'content-type': file.type,
							'x-name': encodeURIComponent(file.name)
						}
					})
				);
				return Response.redirect('/gastos?compartido=archivo', 303);
			}
			const params = new URLSearchParams();
			for (const key of ['title', 'text', 'url']) {
				const value = form.get(key);
				if (typeof value === 'string' && value) params.set(key, value);
			}
			return Response.redirect(`/compartido?${params}`, 303);
		})()
	);
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
