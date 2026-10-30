import { fold } from 'comun/music.ts';
import type { LngLat } from './road.ts';
import { alongLine, locate, metresBetween } from './road-guide.ts';

/**
 * Places and routes kept with their name (#151), in Viajes, for the road mode and the voice. Shared
 * by the server and the pages.
 */

export interface SavedPlace {
	id: number;
	name: string;
	at: LngLat;
	/** Its address, if it was found by searching. */
	address: string | null;
}

/** A route's stop: a kept place (its point followed if it is moved) or a point of its own. */
export interface RouteStop {
	name: string;
	at: LngLat;
	placeId?: number;
}

/** A stop on the way to the route on: a kept route's, or one said by voice (#312), with why. */
export interface WayStop extends RouteStop {
	/** «comprar pan casero», as said: «tu parada para comprar pan casero». */
	reason?: string | null;
}

export interface SavedRoute {
	id: number;
	name: string;
	stops: RouteStop[];
	line: LngLat[];
	distance: number;
	duration: number;
}

/** openrouteservice takes up to 50 points; a route of one's own has far fewer. */
export const MAX_STOPS = 25;

/** Closer than this to a stop on the way, it is passed: the route goes on to the next. */
export const STOP_REACHED_METRES = 150;

/** Its words, accents and case aside, without what is said before a name («a», «la ruta del»). */
function key(text: string) {
	return fold(text)
		.replace(/[¡!¿?.,;:«»"']/g, ' ')
		.replace(
			/^\s*(?:(?:la|mi)\s+)?(?:ruta|camino)(?:\s+(?:de la|del|de|a la|al|a|hasta|hacia))?\s+/,
			''
		)
		.replace(/^\s*(?:a la|al|a|hasta|hacia)\s+/, '')
		.replace(/^\s*(?:el|la|los|las|mi|mis)\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The one said or typed («casa», «llévame al trabajo» as «trabajo», «la ruta del cole»): its name
 * as it is, or else the only one whose name has every word said.
 */
export function findByName<T extends { name: string }>(list: T[], said: string): T | null {
	const wanted = key(said);
	if (!wanted) return null;
	const exact = list.find((item) => key(item.name) === wanted);
	if (exact) return exact;
	const words = wanted.split(' ');
	const partial = list.filter((item) => {
		const name = key(item.name);
		return words.every((w) => name.includes(w));
	});
	return partial.length === 1 ? partial[0]! : null;
}

/** «La ruta de…», «ruta al…»: a route is asked for, not a place. */
export function asksForRoute(said: string) {
	return /^\s*(?:(?:la|mi)\s+)?(?:ruta|camino)\b/.test(fold(said));
}

/**
 * Where a kept route goes from `here` (#151): the stops ahead, past where we are along its way, to
 * its end. From anywhere: the start is never gone back to, and a stop already passed is not
 * either.
 */
export function stopsAhead(route: Pick<SavedRoute, 'stops' | 'line'>, here: LngLat): RouteStop[] {
	const rest = route.stops.slice(1);
	if (rest.length <= 1 || route.line.length < 2) return rest.slice(-1);
	const along = alongLine(route.line);
	const at = locate(route.line, along, here).along;
	const end = rest.at(-1)!;
	const ahead = rest
		.slice(0, -1)
		.filter(
			(stop) =>
				locate(route.line, along, stop.at).along > at &&
				metresBetween(stop.at, here) > STOP_REACHED_METRES
		);
	return [...ahead, end];
}

/**
 * The stops ahead with a new one (#312), where it lengthens the way least: from `here` through them
 * to `end`, as the crow flies. «Para en Totana» going to Alicante with a stop in Murcia: Totana
 * first, being before it.
 */
export function insertStop<T extends { at: LngLat }>(
	stops: T[],
	stop: T,
	here: LngLat,
	end: LngLat
): T[] {
	const points = [here, ...stops.map((s) => s.at), end];
	let best = 0;
	let least = Infinity;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i]!;
		const b = points[i + 1]!;
		const more = metresBetween(a, stop.at) + metresBetween(stop.at, b) - metresBetween(a, b);
		if (more < least) [best, least] = [i, more];
	}
	return [...stops.slice(0, best), stop, ...stops.slice(best)];
}
