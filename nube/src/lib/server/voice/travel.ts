import type { LngLat, Place } from 'comun/road.ts';
import { metresBetween } from 'comun/road-guide.ts';

/**
 * Where «¿cuánto tardo a…?» goes (`travel_time`), from what was said as a navigator would take it,
 * «El Extremeño, Sangonera la Seca, Murcia»: the town first, among towns only, and then what is in
 * it, by where it is. Not by its name: Puerto Lumbreras has a «Calle Sangonera la Seca», which
 * openrouteservice gave for the restaurant (2026-11-01).
 */

/** How far from the town's centre what is in it can be: a town and its outskirts. */
export const IN_TOWN_METRES = 6000;

/** «El Extremeño, Sangonera la Seca, Murcia» → what («El Extremeño») and the town after it. */
export function splitPlace(said: string): { what: string; town: string | null } {
	const [what = '', ...rest] = said.split(',').map((part) => part.trim());
	const town = rest.filter(Boolean).join(', ');
	return { what, town: town || null };
}

/** The first result within the town (`IN_TOWN_METRES` of its centre), or null. */
export function inTown(results: Place[], town: LngLat): Place | null {
	return results.find((p) => metresBetween(p.at, town) <= IN_TOWN_METRES) ?? null;
}
