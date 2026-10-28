import { self } from '$app/service-worker';
import { SHARED_CACHE, SHARED_KEY } from '#lib/shared-file.ts';

/**
 * The cloud's service worker (#253), as jellycartoon's: for files shared to the app. It caches
 * nothing else: the app works as always without it.
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
