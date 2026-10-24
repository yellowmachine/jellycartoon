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
