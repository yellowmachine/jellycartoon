import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { startScheduler } from '#lib/server/scheduler.ts';

/**
 * Signing in, Better Auth's own and the health check; and the house's API, with its key, checked
 * by each route (house-keys.ts). The rest needs a session.
 */
/** The cloud's own clock: the families' alarms and agenda notices (scheduler.ts). */
export const init: ServerInit = () => {
	if (!building) startScheduler();
};

/** `/s/`: a shared trip's link (#81), for whoever has it; `/invitacion/`, an invitation's. */
const PUBLIC_PATHS = [
	'/login',
	'/api/auth',
	'/api/health',
	'/api/casa/',
	'/api/calendario/',
	'/s/',
	'/invitacion/'
];

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else if (
		// `/` alone: the landing page, for whoever has no session.
		event.url.pathname !== '/' &&
		!PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))
	) {
		if (event.url.pathname.startsWith('/api/'))
			return new Response('Unauthorized', { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	return svelteKitHandler({ event, resolve, auth, building });
};
