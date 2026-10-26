import { DEFAULT_ORS_URL, orsConfig } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import type { LngLat, Place, Route } from '#lib/road.ts';
import { placesFromOrs, routeFromOrs } from './ors-parse.ts';
import { withRetries } from './retry.ts';

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
	const ask = () =>
		fetch(`${url}${path}`, {
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
	const { res, unavailable } = await withRetries(ask, {
		onRetry: (status) =>
			log.warn('rutas', `openrouteservice respondió ${status}: se pregunta otra vez`, { path })
	});
	if (unavailable)
		throw new OrsError('openrouteservice no responde ahora mismo: prueba en un momento.');
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

/**
 * Suggestions while the destination is typed: openrouteservice's autocomplete, quicker and meant
 * for it, the nearest to `near` first. Its own quota (100 a minute), apart from searches'.
 */
export async function suggestPlaces(text: string, near: LngLat | null): Promise<Place[]> {
	const params = new URLSearchParams({ text, size: '5', lang: 'es' });
	if (near) {
		params.set('focus.point.lon', String(near[0]));
		params.set('focus.point.lat', String(near[1]));
	}
	return placesFromOrs(await ors('search', `/geocode/autocomplete?${params}`));
}

/** What is at a point (reverse geocoding): «Calle Mayor 5, Toledo», for «¿dónde estoy?». */
export async function whereIs(at: LngLat): Promise<string | null> {
	const params = new URLSearchParams({
		'point.lon': String(at[0]),
		'point.lat': String(at[1]),
		size: '1',
		lang: 'es'
	});
	return placesFromOrs(await ors('search', `/geocode/reverse?${params}`))[0]?.label ?? null;
}

/** openpoiservice's category for petrol stations: https://giscience.github.io/openrouteservice/api-reference/endpoints/poi/ */
const FUEL_CATEGORY = 596;

/**
 * Where fuel was put in, short (#194): the petrol station within 150 m, as OpenStreetMap names it
 * (openrouteservice's POIs, only those of the fuel category), and its town; or only the town. Null
 * if nothing.
 */
export async function placeName(at: LngLat): Promise<string | null> {
	const [stations, area] = await Promise.all([
		ors('search', '/pois', {
			method: 'POST',
			body: JSON.stringify({
				request: 'pois',
				geometry: { geojson: { type: 'Point', coordinates: at }, buffer: 150 },
				filters: { category_ids: [FUEL_CATEGORY] },
				limit: 5
			})
		}) as Promise<{
			features?: { properties?: { distance?: number; osm_tags?: Record<string, string> } }[];
		} | null>,
		ors(
			'search',
			`/geocode/reverse?${new URLSearchParams({
				'point.lon': String(at[0]),
				'point.lat': String(at[1]),
				size: '1',
				layers: 'locality,localadmin',
				lang: 'es'
			})}`
		) as Promise<{ features?: { properties?: { name?: string } }[] } | null>
	]);
	const nearest = (stations?.features ?? [])
		.map((f) => f.properties)
		.sort((a, b) => (a?.distance ?? Infinity) - (b?.distance ?? Infinity))[0]?.osm_tags;
	const station = nearest?.name ?? nearest?.brand ?? nearest?.operator ?? null;
	const town = area?.features?.[0]?.properties?.name ?? null;
	if (station) return town && town !== station ? `${station} (${town})` : station;
	return town;
}

/**
 * By car through `points`, from the first to the last, with its steps in Spanish. With stops on the
 * way (#151), not turning back at them.
 */
export async function drivingRoute(points: LngLat[]): Promise<Route> {
	const route = routeFromOrs(
		await ors('routes', '/v2/directions/driving-car/geojson', {
			method: 'POST',
			body: JSON.stringify({
				coordinates: points,
				language: 'es',
				instructions: true,
				...(points.length > 2 ? { continue_straight: true } : {})
			})
		})
	);
	if (!route) throw new OrsError('openrouteservice no encontró una ruta');
	log.info('rutas', 'Ruta pedida a openrouteservice', {
		metres: Math.round(route.distance),
		steps: route.steps.length,
		stops: points.length
	});
	return route;
}

/** What to tell the page: ours as they are, anything else (a bug) only in the Registro. */
export function orsMessage(error: unknown, what: string) {
	if (error instanceof OrsError) return error.message;
	log.warn('rutas', `No se pudo ${what}`, { error });
	return `No se pudo ${what}.`;
}
