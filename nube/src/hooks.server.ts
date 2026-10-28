import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';

/**
 * Signing in, Better Auth's own and the health check; and the house's API, with its key, checked
 * by each route (house-keys.ts). The rest needs a session.
 */
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/health', '/api/casa/'];

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else if (!PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		if (event.url.pathname.startsWith('/api/'))
			return new Response('Unauthorized', { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	return svelteKitHandler({ event, resolve, auth, building });
};
