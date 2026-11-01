import type { LngLat, Place, Route } from 'comun/road.ts';
import { placesFromOrs, routeFromOrs, townsFromOrs } from 'comun/road/ors-parse.ts';
import {
	ALONG_BUFFER_METRES,
	POI_KINDS,
	POI_RADIUS_METRES,
	poisAlong,
	poisFromOrs,
	stretches,
	type PoiKind
} from 'comun/road/pois.ts';
import { withRetries } from 'comun/road/retry.ts';

/**
 * openrouteservice (https://openrouteservice.org), for the road mode (#78): places by their name
 * and the route by car with its steps in Spanish. From the server only: the key never reaches the
 * browser. Its free plan counts requests a day and a minute; going over is said as such. Each app
 * gives its own key (`config`): the house's Ajustes, or each family's in the cloud (#253).
 */

export const DEFAULT_ORS_URL = 'https://api.openrouteservice.org';

export interface OrsConfig {
	apiKey: string | null;
	/** Where routes are asked: openrouteservice's, or one's own (Docker), without a key. */
	url: string;
}

/** Where what happens is told: each app's log. */
export interface OrsLog {
	info: (what: string, data?: Record<string, unknown>) => void;
	warn: (what: string, data?: Record<string, unknown>) => void;
}

export class OrsError extends Error {}

/** openrouteservice with `config`, whose problems are said for people (OrsError). */
export function createOrs(config: () => Promise<OrsConfig>, log: OrsLog) {
	/**
	 * `routes`: from the address in Ajustes, which may be one's own (Docker), without a key. Searching
	 * places is always openrouteservice's own: a self-hosted one does not search.
	 */
	async function ors(what: 'routes' | 'search', path: string, init: RequestInit = {}) {
		const { url: routesUrl, apiKey } = await config();
		const url = what === 'routes' ? routesUrl : DEFAULT_ORS_URL;
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
				log.warn(`openrouteservice respondió ${status}: se pregunta otra vez`, { path })
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

	/**
	 * Up to five places for what was typed or said, the nearest to `near` first; with `country`
	 * (ISO alpha-2, «ES»), only there.
	 */
	async function searchPlaces(
		text: string,
		near: LngLat | null,
		country?: string
	): Promise<Place[]> {
		const params = new URLSearchParams({ text, size: '5', lang: 'es' });
		if (country) params.set('boundary.country', country);
		if (near) {
			params.set('focus.point.lon', String(near[0]));
			params.set('focus.point.lat', String(near[1]));
		}
		return placesFromOrs(await ors('search', `/geocode/search?${params}`));
	}

	/**
	 * Towns and cities for what was typed or said, the most likely first, as the weather's places:
	 * the whole phrase understood («velez rubio almeria»), which Open-Meteo's search does not.
	 */
	async function searchTowns(text: string, count = 5) {
		const params = new URLSearchParams({ text, size: String(count), lang: 'es', layers: 'coarse' });
		return townsFromOrs(await ors('search', `/geocode/search?${params}`));
	}

	/**
	 * Suggestions while the destination is typed: openrouteservice's autocomplete, quicker and meant
	 * for it, the nearest to `near` first. Its own quota (100 a minute), apart from searches'.
	 */
	async function suggestPlaces(text: string, near: LngLat | null): Promise<Place[]> {
		const params = new URLSearchParams({ text, size: '5', lang: 'es' });
		if (near) {
			params.set('focus.point.lon', String(near[0]));
			params.set('focus.point.lat', String(near[1]));
		}
		return placesFromOrs(await ors('search', `/geocode/autocomplete?${params}`));
	}

	/** What is at a point (reverse geocoding): «Calle Mayor 5, Toledo», for «¿dónde estoy?». */
	async function whereIs(at: LngLat): Promise<string | null> {
		const params = new URLSearchParams({
			'point.lon': String(at[0]),
			'point.lat': String(at[1]),
			size: '1',
			lang: 'es'
		});
		return placesFromOrs(await ors('search', `/geocode/reverse?${params}`))[0]?.label ?? null;
	}

	/**
	 * The town or village nearest to a point, by its name alone («Pajares»): for a warning on a
	 * trip's way (route-weather.ts). Null if none is known.
	 */
	async function townNear(at: LngLat): Promise<string | null> {
		const params = new URLSearchParams({
			'point.lon': String(at[0]),
			'point.lat': String(at[1]),
			layers: 'locality,localadmin',
			size: '1',
			lang: 'es'
		});
		const body = (await ors('search', `/geocode/reverse?${params}`)) as {
			features?: { properties?: { name?: string } }[];
		} | null;
		return body?.features?.[0]?.properties?.name ?? null;
	}

	/** openpoiservice's category for petrol stations: https://giscience.github.io/openrouteservice/api-reference/endpoints/poi/ */
	const FUEL_CATEGORY = 596;

	/**
	 * Where fuel was put in, short (#194): the petrol station within 150 m, as OpenStreetMap names it
	 * (openrouteservice's POIs, only those of the fuel category), and its town; or only the town. Null
	 * if nothing.
	 */
	async function placeName(at: LngLat): Promise<string | null> {
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
	 * Places of that kind around `at` (#312), within 2 km, nearest first: «una panadería en Totana».
	 * OpenStreetMap's, so a village's may be missing.
	 */
	async function placesAround(at: LngLat, kind: PoiKind) {
		const body = await ors('search', '/pois', {
			method: 'POST',
			body: JSON.stringify({
				request: 'pois',
				geometry: { geojson: { type: 'Point', coordinates: at }, buffer: POI_RADIUS_METRES },
				filters: { category_ids: POI_KINDS[kind] },
				limit: 50
			})
		});
		const found = poisFromOrs(body, kind);
		log.info('Sitios pedidos a openrouteservice', { kind, found: found.length });
		return found;
	}

	/**
	 * Places of that kind by the route ahead (#312), the first we come to first: «la próxima
	 * gasolinera». `line` from where we are, up to `upTo` metres; each stretch, a search.
	 */
	async function placesAlong(line: LngLat[], kind: PoiKind, upTo: number) {
		const bodies = await Promise.all(
			stretches(line, upTo).map((part) =>
				ors('search', '/pois', {
					method: 'POST',
					body: JSON.stringify({
						request: 'pois',
						geometry: {
							geojson: { type: 'LineString', coordinates: part },
							buffer: ALONG_BUFFER_METRES
						},
						filters: { category_ids: POI_KINDS[kind] },
						limit: 200
					})
				})
			)
		);
		const found = poisAlong(bodies, line, kind).filter((p) => p.distance <= upTo);
		log.info('Sitios en la ruta pedidos a openrouteservice', { kind, found: found.length });
		return found;
	}

	/**
	 * By car through `points`, from the first to the last, with its steps in Spanish. With stops on the
	 * way (#151), not turning back at them.
	 */
	async function drivingRoute(points: LngLat[]): Promise<Route> {
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
		log.info('Ruta pedida a openrouteservice', {
			metres: Math.round(route.distance),
			steps: route.steps.length,
			stops: points.length
		});
		return route;
	}

	/** What to tell the page: ours as they are, anything else (a bug) only in the log. */
	function orsMessage(error: unknown, what: string) {
		if (error instanceof OrsError) return error.message;
		log.warn(`No se pudo ${what}`, { error });
		return `No se pudo ${what}.`;
	}

	return {
		searchPlaces,
		searchTowns,
		suggestPlaces,
		whereIs,
		townNear,
		placeName,
		placesAround,
		placesAlong,
		drivingRoute,
		orsMessage
	};
}
