import { metresBetween } from 'comun/road-guide.ts';
import type { LngLat } from 'comun/road.ts';

/**
 * The road mode's trips (#81): what the browser keeps of the GPS and what the server makes of it.
 * Shared, and plain maths, to be tested.
 */

/** A position as the browser sends it: when (ms since 1970), where, and its speed in m/s. */
export interface TripPoint {
	t: number;
	at: LngLat;
	speed: number | null;
}

/** As a trip keeps it: [longitude, latitude, seconds since 1970]. */
export type StoredPoint = [number, number, number];

/** A point is kept once we have moved this far from the last one kept. */
export const KEEP_EVERY_METRES = 25;
/** Positions worse than this are left out: GPS guesses, not where we are. */
export const WORST_ACCURACY_METRES = 50;
/** This long without positions, and the next one starts another trip. */
export const NEW_TRIP_AFTER_MS = 10 * 60_000;
/** Faster than this between two points (~250 km/h) is the GPS jumping, not the car. */
const IMPOSSIBLE_SPEED = 70;

/** Whether the browser keeps this position, after the last one it kept. */
export function worthKeeping(last: TripPoint | null, next: TripPoint, accuracy: number | null) {
	if (accuracy !== null && accuracy > WORST_ACCURACY_METRES) return false;
	return !last || metresBetween(last.at, next.at) >= KEEP_EVERY_METRES;
}

/**
 * New points for a trip, after its last one (null for a new trip): in order, without the GPS's
 * jumps; and the metres they add and the fastest speed among them.
 */
export function addPoints(last: StoredPoint | null, points: TripPoint[]) {
	const sorted = [...points].sort((a, b) => a.t - b.t);
	const kept: StoredPoint[] = [];
	let previous = last;
	let distance = 0;
	let maxSpeed: number | null = null;
	for (const p of sorted) {
		const sec = Math.round(p.t / 1000);
		if (previous) {
			const metres = metresBetween([previous[0], previous[1]], p.at);
			const seconds = sec - previous[2];
			if (seconds <= 0 || metres / seconds > IMPOSSIBLE_SPEED) continue;
			distance += metres;
		}
		if (p.speed !== null && p.speed < IMPOSSIBLE_SPEED) maxSpeed = Math.max(maxSpeed ?? 0, p.speed);
		const point: StoredPoint = [p.at[0], p.at[1], sec];
		kept.push(point);
		previous = point;
	}
	return { kept, distance, maxSpeed };
}

/** «1 h 25 min», «12 min». */
export function durationText(seconds: number) {
	const minutes = Math.round(seconds / 60);
	return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
