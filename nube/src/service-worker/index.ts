import { version } from '$app/env';
import { immutable } from '$app/manifest';
import { self } from '$app/service-worker';
import { EJS_CACHE, EJS_DATA, GAMES_CACHE, PLAYER_PAGE } from '#lib/offline-games.ts';
import { KEPT_PAGES, OFFLINE_PAGE, PAGES_CACHE_PREFIX } from '#lib/offline-pages.ts';
import { SHARED_CACHE, SHARED_KEY } from '#lib/shared-file.ts';

/**
 * The cloud's service worker (#253), as jellycartoon's: for the family's notices (Web Push,
 * push.ts on the server), such as an alarm ringing or the agenda's, for files shared to the app,
 * and for the games carried without coverage (below). Nothing else is cached: the app works as
 * always without it.
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
	actions?: { action: string; title: string; post?: string; url?: string }[];
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
			actions: message.actions?.map(({ action, title }) => ({ action, title })),
			data: { url: message.url, actions: message.actions ?? [] }
		} as NotificationOptions)
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
 * then it is taken there, or a new window opens. One of its buttons, its own POST first.
 */
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const button = (event.notification.data?.actions as PushMessage['actions'])?.find(
		(a) => a.action === event.action
	);
	// A button that opens a page of its own («Contestar», #330); otherwise the notice's.
	const to: string = button?.url ?? event.notification.data?.url ?? '/';
	const url = new URL(to, self.location.origin).href;
	event.waitUntil(
		(async () => {
			// A button of its own («✓ Tomada», #308): done here, with the session's cookie. Failed (the
			// session gone, no network), the app opens, to do it there.
			if (button?.post) {
				const res = await fetch(button.post, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{}'
				}).catch(() => null);
				if (res?.ok) return;
			}
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

/**
 * The app's own code (its hashed files, which never change), kept as a version installs, as in
 * SvelteKit's documented service worker (https://svelte.dev/docs/kit/service-workers): so that the
 * app opens with no network. Only what is missing: most files stay from one version to the next.
 * Not the wake word's WebAssembly (14 MB), which only a voice with network uses. Only this
 * version's: what a new one no longer has goes as it starts.
 */
const CODE_CACHE = 'codigo';
const code = new Set(
	immutable.map(({ path }) => new URL(path, `${self.location.origin}/`).pathname)
);
/** This version's pages (offline-pages.ts): they name its code. */
const PAGES_CACHE = `${PAGES_CACHE_PREFIX}${version}`;

/** A page's own answer, to keep: not a redirect (to /login, the session gone) nor an error. */
const isPage = (response: Response) =>
	response.ok &&
	!response.redirected &&
	Boolean(response.headers.get('content-type')?.startsWith('text/html'));

async function keepCode() {
	const cache = await caches.open(CODE_CACHE);
	const held = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
	await cache.addAll([...code].filter((path) => !held.has(path) && !path.endsWith('.wasm')));
}

/** The pages, with the session's cookie: with none (not in), none kept, and the next time. */
async function keepPages() {
	const cache = await caches.open(PAGES_CACHE);
	for (const { path, from } of KEPT_PAGES) {
		const response = await fetch(from).catch(() => null);
		if (response && isPage(response)) await cache.put(path, response);
	}
}

self.addEventListener('install', (event) => {
	// Without its code the new version does not install: the old one goes on, and it tries again.
	event.waitUntil(Promise.all([keepCode(), keepPages().catch(() => {})]));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CODE_CACHE);
			for (const request of await cache.keys())
				if (!code.has(new URL(request.url).pathname)) await cache.delete(request);
			for (const name of await caches.keys())
				if (name.startsWith(PAGES_CACHE_PREFIX) && name !== PAGES_CACHE) await caches.delete(name);
		})()
	);
});

async function fromCode(request: Request) {
	const cache = await caches.open(CODE_CACHE);
	const kept = await cache.match(request);
	if (kept) return kept;
	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

/**
 * Going to a page: the network's, as always. A kept one (offline-pages.ts), kept again, fresh, if
 * what it shows is the same (not Carretera's, with the server's data).
 * With no network, the kept one; any other, «Sin conexión», with where it was going. The login's
 * page, reached: the session is gone, and with it the kept pages, which show who was in.
 */
async function navigation(request: Request) {
	const url = new URL(request.url);
	const cache = await caches.open(PAGES_CACHE);
	try {
		const response = await fetch(request);
		const kept = KEPT_PAGES.some((p) => p.path === url.pathname && p.from === p.path);
		if (kept && isPage(response)) void cache.put(url.pathname, response.clone());
		if (url.pathname === '/login' && response.ok) void caches.delete(PAGES_CACHE);
		return response;
	} catch (problem) {
		const page = await cache.match(url.pathname);
		if (page) return page;
		if (url.pathname !== OFFLINE_PAGE && (await cache.match(OFFLINE_PAGE))) {
			const from = encodeURIComponent(url.pathname + url.search);
			return Response.redirect(`${OFFLINE_PAGE}?desde=${from}`, 302);
		}
		throw problem;
	}
}

/**
 * What a game carried without coverage needs (offline-games.svelte.ts), from where it was kept and
 * not from the network: the game and its box from the house, EmulatorJS' files from its CDN. A
 * HEAD (EmulatorJS asks the game's size before taking it), the kept one's headers. Not kept, from
 * the network as always.
 */
async function kept(name: string, request: Request) {
	const found = await caches.open(name).then((c) => c.match(request.url));
	if (!found) return fetch(request);
	if (request.method === 'HEAD')
		return new Response(null, { status: found.status, headers: found.headers });
	return found;
}

/** The player's page: the network's, or the one kept when there is none. */
async function playerPage(request: Request) {
	try {
		return await fetch(request);
	} catch (problem) {
		const found = await caches
			.open(GAMES_CACHE)
			.then((c) => c.match(PLAYER_PAGE, { ignoreSearch: true }));
		if (found) return found;
		throw problem;
	}
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' && request.method !== 'HEAD') return;
	const url = new URL(request.url);
	const here = url.origin === self.location.origin;
	if (here && request.method === 'GET' && code.has(url.pathname))
		event.respondWith(fromCode(request));
	else if (url.href.startsWith(EJS_DATA)) event.respondWith(kept(EJS_CACHE, request));
	else if (here && url.pathname.startsWith('/api/juegos/'))
		event.respondWith(kept(GAMES_CACHE, request));
	else if (here && request.method === 'GET' && url.pathname === PLAYER_PAGE)
		event.respondWith(playerPage(request));
	else if (here && request.method === 'GET' && request.mode === 'navigate')
		event.respondWith(navigation(request));
});
