/**
 * The road mode's routes (#78): what the server gives the page, from openrouteservice. Shared by
 * the server and the pages. Coordinates as [longitude, latitude], as GeoJSON and MapLibre.
 */

export type LngLat = [number, number];

/** A point as it comes from a page: two numbers, on the Earth. */
export const isLngLat = (value: unknown): value is LngLat =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every(Number.isFinite) &&
	Math.abs(value[0]) <= 180 &&
	Math.abs(value[1]) <= 90;

/** A place found by its name or address. */
export interface Place {
	/** «Calle Mayor 5, Toledo, España». */
	label: string;
	at: LngLat;
}

export interface RouteStep {
	/** In Spanish, as openrouteservice says it: «Gira a la derecha por Calle Mayor». */
	instruction: string;
	/** Metres from this step to the next. */
	distance: number;
	/** Seconds openrouteservice reckons it takes, at its roads' speeds (#78). */
	duration: number;
	/** Where it is done: the first point of the step. */
	at: LngLat;
	/** That point's index in the route's line, to know how far along it is. */
	index: number;
	/** openrouteservice's maneuver type (0 left, 1 right, 6 straight on, 10 arrival…). */
	type: number;
}

export interface Route {
	/** The line to draw. */
	line: LngLat[];
	/** Metres and seconds, all of it. */
	distance: number;
	duration: number;
	steps: RouteStep[];
}

/** «12,4 km» or «350 m». */
export function distanceText(metres: number) {
	return metres >= 1000
		? `${(metres / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`
		: `${Math.round(metres / 10) * 10} m`;
}
