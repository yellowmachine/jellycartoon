import type { LngLat } from 'comun/road.ts';

/**
 * «¿Dónde está el coche?» (#317), for the server and the pages: where a car is, from the end of
 * its last trip or a later «Aquí y ahora».
 */

export const MAX_CAR_NAME = 40;
export const MAX_CAR_NOTE = 120;

/** Where a car was left, and by whom. */
export type CarPlace = {
	at: LngLat;
	when: Date;
	/** Who left it there, by their name. */
	by: string | null;
	/** «Planta -2, plaza 47»: only from «Aquí y ahora». */
	note: string | null;
	/** From the end of a trip (not said by hand). */
	trip: boolean;
};

export type CarView = { id: number; name: string; place: CarPlace | null };

/** The later of the two: a trip after «Aquí y ahora» moved it, and the other way round. */
export function latestPlace(marked: CarPlace | null, trip: CarPlace | null) {
	if (!marked || !trip) return marked ?? trip;
	return trip.when > marked.when ? trip : marked;
}

/** A trip still being kept: its last position, this recent (the road mode sends every 30 s). */
const MOVING_MS = 2 * 60_000;

export const isMoving = (place: CarPlace, now: Date) =>
	place.trip && now.getTime() - new Date(place.when).getTime() < MOVING_MS;

const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
const day = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });

/** «Hace 5 min», «hace 3 h», «ayer a las 18:40», «el vie, 24 oct a las 9:15». */
export function agoText(when: Date, now: Date) {
	const minutes = Math.round((now.getTime() - when.getTime()) / 60_000);
	if (minutes < 1) return 'ahora mismo';
	if (minutes < 60) return `hace ${minutes} min`;
	if (minutes < 6 * 60) return `hace ${Math.round(minutes / 60)} h`;
	const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((midnight(now) - midnight(when)) / 86_400_000);
	if (days === 0) return `hoy a las ${time.format(when)}`;
	if (days === 1) return `ayer a las ${time.format(when)}`;
	return `el ${day.format(when)} a las ${time.format(when)}`;
}

/** «Llévame»: Google Maps on foot to it, the app on the phone if it is there (its Maps URLs). */
export const walkTo = ([lon, lat]: LngLat) =>
	`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
