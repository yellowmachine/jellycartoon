/**
 * The app's pages that open with no network (service-worker/index.ts): their HTML, kept by the
 * service worker for this version, with the code it names. Only pages drawn from what the device
 * keeps, nothing of theirs asked of the server: one with the server's data would show it stale.
 * Drawn on the server all the same (not `ssr = false`): only so does their HTML carry the layout's
 * data, which the browser would otherwise ask the server for. Any other page, without network, goes to OFFLINE_PAGE, with what works from here.
 */
export const OFFLINE_PAGE = '/sin-conexion';

/**
 * A page that, kept, shows only what works with no network (Carretera): asked with this, and kept
 * under its own path. Not kept again as it is visited, with the server's data.
 */
export const KEPT_SOURCE = 'guardada';

/** Each page, and where its kept HTML is asked for. */
export const KEPT_PAGES = [
	{ path: OFFLINE_PAGE, from: OFFLINE_PAGE },
	{ path: '/juegos/aqui', from: '/juegos/aqui' },
	{ path: '/carretera', from: `/carretera?${KEPT_SOURCE}` }
];

/** This version's pages: a new version's code is another, and the old HTML would name the old. */
export const PAGES_CACHE_PREFIX = 'paginas-';

/** Where to go back to once there is network: a path of the app's own, or its home. */
export function backTo(from: string | null) {
	return from?.startsWith('/') && !from.startsWith('//') ? from : '/';
}

/**
 * In the browser, once in: the pages kept for this version if they are not yet (the service worker
 * keeps them as a version installs, maybe before logging in). Not a redirect (the session gone).
 */
export async function keepOfflinePages(version: string) {
	if (typeof caches === 'undefined') return;
	const cache = await caches.open(`${PAGES_CACHE_PREFIX}${version}`);
	for (const { path, from } of KEPT_PAGES) {
		if (await cache.match(path)) continue;
		const response = await fetch(from);
		const html = response.headers.get('content-type')?.startsWith('text/html');
		if (response.ok && !response.redirected && html) await cache.put(path, response);
	}
}
