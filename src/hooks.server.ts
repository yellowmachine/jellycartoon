import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { startWorker } from '#lib/server/library/worker.ts';

export const init: ServerInit = async () => {
	if (building) return;
	await startWorker();
};

const PUBLIC_PATHS = ['/login', '/api/auth'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else if (!PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		if (event.url.pathname.startsWith('/api/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
