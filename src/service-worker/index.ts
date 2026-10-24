import { self } from '$app/service-worker';

/**
 * The app's service worker: only for the adults' notices (Web Push, push.ts on the server), such
 * as a child asking to enter (#141) or a post-it on the fridge (#131). It caches nothing: the app
 * works as always without it.
 */

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
			badge: '/icon-192.png',
			requireInteraction: message.sticky ?? false,
			data: { url: message.url }
		})
	);
});

/**
 * Touched: the app, at its page. Already open, it goes there itself (the root layout listens), not
 * loaded again: what plays goes on.
 */
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
			if (open) {
				open.postMessage({ goto: event.notification.data?.url ?? '/' });
				return open.focus();
			}
			return self.clients.openWindow(url);
		})()
	);
});
