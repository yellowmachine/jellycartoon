import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { guardKids, isKid } from '#lib/server/kids.ts';
import { entersByApproval } from '#lib/server/kid-login.ts';
import { db } from '#lib/server/db/index.ts';
import { session as sessionTable } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { allowedWhileSettingUp, mustSetUp, SETUP_PATH } from '#lib/server/two-factor.ts';
import { SATELLITE_PATHS, satelliteOf } from '#lib/server/satellites.ts';
import { guardVideoTime } from '#lib/server/kid-time.ts';
import { startWorker } from '#lib/server/library/worker.ts';
import { startSubtitles } from '#lib/server/auto-subtitles.ts';
import { startLabelling } from '#lib/server/episode-labels.ts';
import { startNightlyScan } from '#lib/server/library/nightly.ts';
import { logStartup } from '#lib/server/startup.ts';
import { wakeCatalog } from '#lib/server/cinema/catalog.ts';
import { wakeExtras } from '#lib/server/cinema/info.ts';
import { wakeMusicCatalog } from '#lib/server/music/catalog.ts';
import { startPodcastRefresh } from '#lib/server/podcasts/podcasts.ts';
import { startAlarms } from '#lib/server/alarms/alarms.ts';
import { startTelegram } from '#lib/server/telegram/telegram.ts';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { log, startLogCleanup } from '#lib/server/log.ts';
import { piperEnabled } from '#lib/server/piper.ts';
import { warmFillers } from '#lib/server/voice-fillers.ts';

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
	// Episodes left waiting to be labelled, or half done, by a restart.
	await startLabelling();
	// Every night, what was added to the folders: converted and subtitled by the morning.
	startNightlyScan();
	// New episodes of the followed podcasts, every few hours.
	startPodcastRefresh();
	// The timers (#241): what came due while it was off rings now. The alarms, in the cloud (#253).
	startAlarms();
	// The Telegram accounts connected (#243), listened to again.
	void startTelegram().catch((error) => log.error('telegram', 'Al arrancar', { error }));
	// What the voice satellites say while the AI thinks (#223), read beforehand to sound at once.
	if (piperEnabled) void warmFillers();
	// In the Registro: which version started, and how each of the above starts.
	await logStartup();
	// adapter-node has closed the server on SIGTERM; the timers above would keep the process alive
	// until Docker kills it. Work left half done is picked up on the next start (#228).
	process.once('sveltekit:shutdown', () => process.exit(0));
};

/** Unexpected errors only: the ones thrown on purpose with `error()` (404, 400…) are not news. */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	log.error('http', `${event.request.method} ${event.url.pathname}`, { error });
};

// /rest: the Subsonic API logs in with its own parameters (#27). /quien: the children choosing
// their avatar on a trusted device, before they have a session (#141). /bienvenida: an adult
// choosing their password with the link the administrator gave them (#157). /api/v1: the video
// API for the cloud, and its alarms ringing here, with its key or a signed link, checked by each
// route (media-api.ts, #253).
const PUBLIC_PATHS = [
	'/login',
	'/bienvenida',
	'/api/auth',
	'/api/health',
	'/rest/',
	'/quien',
	'/api/quien/',
	'/api/v1/'
];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	// A child who enters with a parent's permission, in a session not opened by it (its password
	// is one only the server knows, but just in case): closed, and back to choosing its avatar.
	if (
		session &&
		isKid(session.user) &&
		!session.session.kidApproved &&
		(await entersByApproval(session.user.id))
	) {
		await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));
		if (event.url.pathname.startsWith('/api/'))
			return new Response('Unauthorized', { status: 401 });
		redirect(303, '/quien');
	}

	// A voice satellite with its key (#223): only on its few paths, and never a session.
	const satellite =
		!session && SATELLITE_PATHS.includes(event.url.pathname)
			? await satelliteOf(event.request)
			: null;

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		// The administrator's first sign-in without a second step: nothing else until it is set up.
		if (mustSetUp(session.session, session.user) && !allowedWhileSettingUp(event.url.pathname)) {
			if (event.url.pathname.startsWith('/api/'))
				return new Response('Falta la verificación en dos pasos', { status: 403 });
			redirect(303, SETUP_PATH);
		}
		await guardKids(event);
		await guardVideoTime(event);
	} else if (satellite) {
		event.locals.satellite = satellite;
	} else if (!PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		if (event.url.pathname.startsWith('/api/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		// With its query: the phone's /entrar?codigo=… (#172) comes back to the same code.
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
