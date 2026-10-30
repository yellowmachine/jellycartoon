import { redirect } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { startScheduler } from '#lib/server/scheduler.ts';
import { noteCosts } from '#lib/server/ai-spend.ts';
import { isKidAccount, kidMayOpen } from '#lib/server/kids.ts';

/**
 * Signing in, Better Auth's own and the health check; and the house's API, with its key, checked
 * by each route (house-keys.ts). The rest needs a session.
 */
/** The cloud's own clock: the families' alarms and agenda notices (scheduler.ts); and the AI's costs. */
export const init: ServerInit = () => {
	if (building) return;
	startScheduler();
	noteCosts();
};

/** `/s/`: a shared trip's link (#81), for whoever has it; `/invitacion/`, an invitation's. */
const PUBLIC_PATHS = [
	'/login',
	'/api/auth',
	'/api/health',
	'/api/casa/',
	// The voice satellites Seilide serves (#296), with their key (satellites.ts), at the house's paths.
	'/api/voice/',
	'/api/satelite/',
	'/api/salon/bajar',
	'/api/calendario/',
	// The apps' AI, with the person's access token (app-ai.ts).
	'/api/ia/',
	// How each night's copy of the VPS's apps went (deploy/vps-backup.sh), with its token (admin.ts).
	'/api/admin/copias',
	'/s/',
	'/invitacion/',
	// «¿Quién eres?» (#303): a child choosing its drawing on the family's device, by its cookie.
	'/quien',
	'/api/quien/'
];

/**
 * Where the OpenID provider's clients, houses and apps, post from their servers, without an Origin:
 * they prove who they are with their secret, not a session's cookie.
 */
const CLIENT_POSTS = [
	'/api/auth/oauth2/token',
	'/api/auth/oauth2/introspect',
	'/api/auth/oauth2/revoke'
];
const FORM_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];

/** SvelteKit's own check against forms from other sites (off in vite.config.ts), but for those. */
const checkCsrf: Handle = ({ event, resolve }) => {
	const { request, url } = event;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
	const forbidden =
		!dev &&
		!CLIENT_POSTS.includes(url.pathname) &&
		['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
		(!type || FORM_TYPES.includes(type)) &&
		request.headers.get('origin') !== url.origin;
	if (forbidden)
		return new Response(`Cross-site ${request.method} form submissions are forbidden`, {
			status: 403
		});
	return resolve(event);
};

const session: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		// A child, only where it may (#303): a page elsewhere takes it home; an API says no.
		const { pathname } = event.url;
		if (!kidMayOpen(pathname, event.request.method) && (await isKidAccount(session.user.id))) {
			if (pathname.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
			redirect(303, '/');
		}
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

export const handle = sequence(checkCsrf, session);
