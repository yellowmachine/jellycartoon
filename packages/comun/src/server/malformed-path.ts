import type { Handle } from '@sveltejs/kit/hooks';

/**
 * A path that cannot be decoded («/%C0», from the scanners that try every site), refused first
 * with a 400. SvelteKit runs `handle` for it outside its error boundary, so a `redirect()` there
 * (to /login, for whoever has no session) is not caught and takes the whole server down
 * (https://github.com/sveltejs/kit/issues/17193, open in 3.1.1). Decoded as SvelteKit does
 * (`decode_pathname`), so it refuses exactly what it would have called «Malformed URI». Until it
 * is fixed there, first in both apps' `handle`.
 */
export const rejectMalformedPath: Handle = ({ event, resolve }) => {
	try {
		event.url.pathname.split('%25').map(decodeURI);
	} catch {
		return new Response('Bad Request', { status: 400 });
	}
	return resolve(event);
};
