import { version } from '$app/env';
import { deviceName } from '#lib/device-name.svelte.ts';

/**
 * What the players do with the page hidden (the phone in the pocket, its screen off), to the
 * Registro (`reproductor`): music that stops at the end of a song, an episode that pauses as the
 * screen goes off. Only from when the page is hidden with something playing until it is seen
 * again; nothing in normal use. Sent when it can be (the page may be frozen meanwhile: the times
 * say so), and once more when shown.
 */

export type Media = 'música' | 'vídeo';

interface Noted {
	/** The phone's clock, ISO. */
	at: string;
	what: string;
	media?: Media;
	/** Where it was, seconds; or the error. */
	detail?: string;
}

const ENDPOINT = '/api/registro';
/** Enough for a long walk; past it, the newest are dropped (the start says the most). */
const KEPT = 200;
/** Sent this often while hidden, if the browser lets timers run. */
const EVERY_MS = 30_000;

const watched = new Set<HTMLMediaElement>();
let pending: Noted[] = [];
/** Hidden with something playing: what happens is noted until it is shown again. */
let noting = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let stopping: ReturnType<typeof setTimeout> | undefined;
/** Shown again, what happens this long after is noted too. */
const AFTER_SHOWN_MS = 3_000;

const hidden = () => document.visibilityState === 'hidden';
const playing = () => [...watched].some((el) => !el.paused);

function note(what: string, media?: Media, detail?: string) {
	if (!noting) return;
	if (pending.length < KEPT) pending.push({ at: new Date().toISOString(), what, media, detail });
	timer ??= setTimeout(() => void send(), EVERY_MS);
}

function body() {
	return JSON.stringify({ device: deviceName.value || null, version, events: pending });
}

/** What was noted, to the server; kept if it could not be sent, for the next time. */
async function send() {
	clearTimeout(timer);
	timer = undefined;
	if (!pending.length) return;
	const sending = pending;
	pending = [];
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ device: deviceName.value || null, version, events: sending }),
		keepalive: true
	}).catch(() => null);
	if (!res?.ok) pending = [...sending, ...pending].slice(0, KEPT);
	if (pending.length && noting) timer = setTimeout(() => void send(), EVERY_MS);
}

/** Being frozen or closed: a beacon, which the browser sends even then. */
function beacon() {
	if (!pending.length) return;
	if (navigator.sendBeacon?.(ENDPOINT, new Blob([body()], { type: 'application/json' })))
		pending = [];
}

function listen() {
	if (listening) return;
	listening = true;
	document.addEventListener('visibilitychange', () => {
		clearTimeout(stopping);
		if (hidden()) {
			if (!playing() && !noting) return;
			noting = true;
			note('pantalla apagada o app en segundo plano');
		} else if (noting) {
			note('pantalla encendida');
			// What the browser held back may happen now: a moment more, then sent.
			stopping = setTimeout(() => {
				noting = false;
				void send();
			}, AFTER_SHOWN_MS);
		}
	});
	// The Page Lifecycle API (Chrome): the page stopped by the browser to save battery, and back.
	document.addEventListener('freeze', () => {
		note('página congelada por el navegador');
		beacon();
	});
	document.addEventListener('resume', () => note('página descongelada'));
	addEventListener('pagehide', () => {
		note('página cerrada');
		beacon();
	});
}

/**
 * What the phone asked through the lock screen's controls (Media Session): headphones, a call, a
 * notification that takes the sound… or the user. Said apart from the `<audio>`'s own `pause`, to
 * know who stopped it.
 */
export function noteSystemAction(action: string, media: Media) {
	note(`el sistema pide ${action}`, media);
}

/** Paused by the phone alone, and played again by the app (auto-resume.ts). */
export function noteAutoResume(media: Media, inARow: number) {
	note('se había pausado sola: sigue', media, `${inARow}.ª seguida`);
}

/**
 * The next song starts in the other `<audio>` before this one ends (#180): how much of it had
 * loaded, to know whether the browser loads it with the page hidden.
 */
export function noteHandoff(media: Media, next: HTMLMediaElement) {
	const loaded = next.buffered.length ? next.buffered.end(next.buffered.length - 1) : 0;
	note('la siguiente empieza en el otro reproductor', media, `${Math.round(loaded)} s cargados`);
}

/** A player's `<audio>` or `<video>`, watched while it exists: returns how to stop. */
export function watchMedia(el: HTMLMediaElement, media: Media) {
	listen();
	watched.add(el);
	const where = () => `${Math.round(el.currentTime)} s`;
	const events: [string, () => void][] = [
		['play', () => note('play', media, where())],
		['playing', () => note('suena', media, where())],
		['pause', () => note('pausa', media, where())],
		['ended', () => note('terminó', media, where())],
		['waiting', () => note('esperando datos', media, where())],
		['stalled', () => note('la red no da datos', media, where())],
		['error', () => note('error', media, `código ${el.error?.code}: ${el.error?.message ?? ''}`)],
		['emptied', () => note('sin fuente (otra pista)', media)]
	];
	for (const [name, handler] of events) el.addEventListener(name, handler);
	return () => {
		watched.delete(el);
		for (const [name, handler] of events) el.removeEventListener(name, handler);
	};
}

/** A play() this long without an answer: held back by the browser, not refused. */
const UNANSWERED_MS = 5_000;

/**
 * What play() says, instead of swallowing it: no (NotAllowedError, AbortError…), or nothing for a
 * while, as Chrome does with a hidden page's media until it is seen again, and when it finally
 * plays.
 */
export function watchPlay(played: Promise<void>, media: Media) {
	const asked = Date.now();
	let held = false;
	const timer = setTimeout(() => {
		held = true;
		note('play() sin respuesta', media, `${UNANSWERED_MS / 1000} s`);
	}, UNANSWERED_MS);
	played.then(
		() => {
			clearTimeout(timer);
			if (held)
				note(
					'play() aceptado al fin',
					media,
					`${Math.round((Date.now() - asked) / 1000)} s después`
				);
		},
		(error: { name?: string; message?: string } | null) => {
			clearTimeout(timer);
			note(
				'play() rechazado',
				media,
				`${error?.name ?? 'Error'}: ${error?.message ?? ''}`.slice(0, 300)
			);
		}
	);
}
