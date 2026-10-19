import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { TOKEN, TripStore, type Update } from './store.ts';

/**
 * The trips relay (#81): what JellyCartoon (at home, only on Tailscale) shares of a trip, to whoever
 * has its link, on a VPS. Home sends news with PUBLISH_KEY; whoever opens /s/<token> sees the car
 * on a map, live (SSE). Nothing is kept but in memory: see store.ts.
 */

const PUBLISH_KEY = process.env.PUBLISH_KEY;
if (!PUBLISH_KEY || PUBLISH_KEY.length < 24) {
	console.error('PUBLISH_KEY, al menos 24 caracteres: la clave con la que JellyCartoon publica.');
	process.exit(1);
}
const PORT = Number(process.env.PORT) || 3000;
/** News from home are small: a position and a few words. */
const MAX_BODY = 4096;
/** A comment now and then, so proxies do not close a quiet stream. */
const KEEP_ALIVE_MS = 25_000;

const store = new TripStore();
setInterval(() => store.sweep(), 60_000);

const publicDir = path.join(import.meta.dir, 'public');
const maplibreDir = path.join(import.meta.dir, 'node_modules', 'maplibre-gl', 'dist');
/** MapLibre from here, not a CDN: its worker must come from the page's own origin. */
const MAPLIBRE = new Set([
	'maplibre-gl.mjs',
	'maplibre-gl-shared.mjs',
	'maplibre-gl-worker.mjs',
	'maplibre-gl.css'
]);

const page = await Bun.file(path.join(publicDir, 'viaje.html')).text();

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page itself: its title says whose trip (a link's preview in WhatsApp shows it), never where. */
const HEADERS = {
	'Cache-Control': 'no-store',
	'X-Robots-Tag': 'noindex, nofollow',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff'
};
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https://tiles.openfreemap.org",
	"connect-src 'self' https://tiles.openfreemap.org",
	"font-src 'self'",
	"frame-ancestors 'none'"
].join('; ');

function authorized(request: Request) {
	const given = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
	const key = Buffer.from(PUBLISH_KEY!);
	return given.length === key.length && timingSafeEqual(given, key);
}

const num = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const words = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** What home sends, only what is well formed. */
function parseUpdate(body: Record<string, unknown>): Update {
	const update: Update = {};
	if ('name' in body) update.name = words(body.name, 60) ?? '';
	if ('destination' in body) update.destination = words(body.destination, 200);
	if ('arrivesAt' in body) update.arrivesAt = num(body.arrivesAt);
	const p = body.position as Record<string, unknown> | undefined;
	const lon = num(p?.lon);
	const lat = num(p?.lat);
	if (lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)
		update.position = {
			lon,
			lat,
			t: num(p?.t) ?? Date.now(),
			speed: num(p?.speed),
			heading: num(p?.heading)
		};
	return update;
}

/** The trip as whoever watches gets it: `gone` if there is none, or no more (not even its name). */
const view = (token: string) => {
	const trip = store.get(token);
	return JSON.stringify(trip && !trip.ended ? trip : { gone: true });
};

function events(token: string, request: Request) {
	let stop = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (text: string) => controller.enqueue(encoder.encode(text));
			send(`data: ${view(token)}\n\n`);
			const unwatch = store.watch(token, () => send(`data: ${view(token)}\n\n`));
			const keepAlive = setInterval(() => send(': sigue\n\n'), KEEP_ALIVE_MS);
			stop = () => {
				unwatch();
				clearInterval(keepAlive);
			};
			request.signal.addEventListener('abort', () => {
				stop();
				controller.close();
			});
		},
		cancel: () => stop()
	});
	return new Response(stream, {
		headers: { ...HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }
	});
}

Bun.serve({
	port: PORT,
	// The longest Bun allows: a stream is quiet up to KEEP_ALIVE_MS between news (10 s by default).
	idleTimeout: 255,
	async fetch(request) {
		const url = new URL(request.url);
		const [, first, token, rest] = url.pathname.split('/');

		if (url.pathname === '/salud') return new Response('ok');

		// From home: PUT a trip's news, DELETE to stop sharing it.
		if (first === 'api' && token === 'viajes' && rest && TOKEN.test(rest)) {
			if (!authorized(request)) return new Response('No', { status: 401 });
			if (request.method === 'DELETE') {
				store.end(rest);
				return new Response(null, { status: 204 });
			}
			if (request.method !== 'PUT') return new Response(null, { status: 405 });
			const text = await request.text();
			if (text.length > MAX_BODY) return new Response('Demasiado', { status: 413 });
			const body = (() => {
				try {
					return JSON.parse(text);
				} catch {
					return null;
				}
			})();
			if (!body || typeof body !== 'object') return new Response('JSON', { status: 400 });
			store.publish(rest, parseUpdate(body));
			return new Response(null, { status: 204 });
		}

		// For whoever has the link.
		if (first === 's' && token && TOKEN.test(token)) {
			if (rest === 'eventos') return events(token, request);
			if (rest !== undefined) return new Response('No encontrado', { status: 404 });
			const trip = store.get(token);
			const title = trip && !trip.ended && trip.name ? `Viaje de ${trip.name}` : 'Viaje compartido';
			return new Response(page.replaceAll('{{title}}', escape(title)), {
				headers: {
					...HEADERS,
					'Content-Type': 'text/html; charset=utf-8',
					'Content-Security-Policy': CSP
				}
			});
		}

		if (first === 'viaje.js' || first === 'viaje.css') {
			const file = Bun.file(path.join(publicDir, first));
			return new Response(file, { headers: { 'Cache-Control': 'public, max-age=3600' } });
		}
		if (first === 'maplibre' && token && MAPLIBRE.has(token)) {
			const file = Bun.file(path.join(maplibreDir, token));
			return new Response(file, { headers: { 'Cache-Control': 'public, max-age=86400' } });
		}
		return new Response('No encontrado', { status: 404 });
	}
});

console.log(`Repetidor de viajes en el puerto ${PORT}`);
