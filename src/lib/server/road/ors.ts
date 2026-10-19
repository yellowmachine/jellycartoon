import { DEFAULT_ORS_URL, orsConfig } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import type { LngLat, Place, Route } from '#lib/road.ts';
import { placesFromOrs, routeFromOrs } from './ors-parse.ts';

/**
 * openrouteservice (https://openrouteservice.org), for the road mode (#78): places by their name
 * and the route by car with its steps in Spanish. From the server only: the key never reaches the
 * browser. Its free plan counts requests a day and a minute; going over is said as such.
 */

class OrsError extends Error {}

/**
 * `routes`: from the address in Ajustes, which may be one's own (Docker), without a key. Searching
 * places is always openrouteservice's own: a self-hosted one does not search.
 */
async function ors(what: 'routes' | 'search', path: string, init: RequestInit = {}) {
	const config = await orsConfig();
	const url = what === 'routes' ? config.url : DEFAULT_ORS_URL;
	const { apiKey } = config;
	if (!apiKey && url === DEFAULT_ORS_URL)
		throw new OrsError('Falta la clave de openrouteservice: ponla en Ajustes.');
	const res = await fetch(`${url}${path}`, {
		...init,
		headers: {
			...(apiKey ? { Authorization: apiKey } : {}),
			Accept: 'application/json, application/geo+json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers
		},
		signal: AbortSignal.timeout(20_000)
	}).catch((error) => {
		throw new OrsError(`No se pudo hablar con openrouteservice: ${error.message}`);
	});
	const body = await res.json().catch(() => null);
	if (res.status === 429 || res.status === 403)
		throw new OrsError('Se ha acabado la cuota de openrouteservice por ahora: prueba más tarde.');
	if (!res.ok)
		throw new OrsError(
			`openrouteservice respondió ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`
		);
	return body;
}

/** Up to five places for what was typed or said, the nearest to `near` first. */
export async function searchPlaces(text: string, near: LngLat | null): Promise<Place[]> {
	const params = new URLSearchParams({ text, size: '5', lang: 'es' });
	if (near) {
		params.set('focus.point.lon', String(near[0]));
		params.set('focus.point.lat', String(near[1]));
	}
	return placesFromOrs(await ors('search', `/geocode/search?${params}`));
}

/** By car from `from` to `to`, with its steps in Spanish. */
export async function drivingRoute(from: LngLat, to: LngLat): Promise<Route> {
	const route = routeFromOrs(
		await ors('routes', '/v2/directions/driving-car/geojson', {
			method: 'POST',
			body: JSON.stringify({ coordinates: [from, to], language: 'es', instructions: true })
		})
	);
	if (!route) throw new OrsError('openrouteservice no encontró una ruta');
	log.info('rutas', 'Ruta pedida a openrouteservice', {
		metres: Math.round(route.distance),
		steps: route.steps.length
	});
	return route;
}

/** What to tell the page: ours as they are, anything else (a bug) only in the Registro. */
export function orsMessage(error: unknown, what: string) {
	if (error instanceof OrsError) return error.message;
	log.warn('rutas', `No se pudo ${what}`, { error });
	return `No se pudo ${what}.`;
}
