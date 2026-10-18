import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { guardKids } from '#lib/server/kids.ts';
import { guardVideoTime } from '#lib/server/kid-time.ts';
import { startWorker } from '#lib/server/library/worker.ts';
import { startSubtitles } from '#lib/server/auto-subtitles.ts';
import { startNightlyScan } from '#lib/server/library/nightly.ts';
import { wakeCatalog } from '#lib/server/cinema/catalog.ts';
import { wakeExtras } from '#lib/server/cinema/info.ts';
import { wakeMusicCatalog } from '#lib/server/music/catalog.ts';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { log, startLogCleanup } from '#lib/server/log.ts';

export const init: ServerInit = async () => {
	if (building) return;
	startLogCleanup();
	// Films left half catalogued by a restart.
	if (cinemaRoot) wakeCatalog();
	// Info saved before Wikidata's awards, sagas and crew were read: completed in the background.
	if (cinemaRoot) void wakeExtras();
	// Tracks whose tags were not read yet, and covers not looked up.
	if (musicRoot) wakeMusicCatalog();
	await startWorker();
	// Subtitles left waiting, or half made, by a restart.
	await startSubtitles();
	// Every night, what was added to the folders: converted and subtitled by the morning.
	startNightlyScan();
};

/** Unexpected errors only: the ones thrown on purpose with `error()` (404, 400…) are not news. */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	log.error('http', `${event.request.method} ${event.url.pathname}`, { error });
};

// /rest: the Subsonic API logs in with its own parameters (#27).
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/health', '/rest/'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		await guardKids(event);
		await guardVideoTime(event);
	} else if (!PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		if (event.url.pathname.startsWith('/api/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
