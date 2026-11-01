import { metresBetween } from './road-guide.ts';
import type { LngLat } from './road.ts';

/**
 * The trip so far, for the road mode's strip: km driven, time moving, and since the last rest
 * (the DGT asks for one every 2 h). From the GPS positions, kept in the browser: a reload on the way
 * goes on with it; hours without positions, a new trip.
 */

/** Moving faster than this (m/s, about 5 km/h): driving, not parked. */
const MOVING = 1.5;
/** Two positions further apart than this are not added up (the GPS lost, the screen off). */
const GAP_MS = 30_000;
/** Faster than this between two positions (m/s, ~250 km/h) is the GPS jumping, not the car. */
const JUMP_SPEED = 70;
/** Stopped (or without positions) this long is a rest: the 2 h start again. */
export const BREAK_MS = 15 * 60_000;
/** Without positions this long, the next one starts a new trip. */
const NEW_TRIP_MS = 3 * 3_600_000;
/** Driving this long without a rest: time to stop (DGT: every 2 h, ~20 min). */
export const REST_AFTER_SECONDS = 2 * 3600;

export interface TripState {
	metres: number;
	/** Seconds moving, all the trip. */
	moving: number;
	/** Seconds moving since the last rest. */
	sinceBreak: number;
	/** The rest already asked for, since the last one: once. */
	restSaid: boolean;
	/** Stopped since (Date.now()), while stopped. */
	stoppedSince: number | null;
	last: { at: LngLat; time: number } | null;
}

export const newTrip = (): TripState => ({
	metres: 0,
	moving: 0,
	sinceBreak: 0,
	restSaid: false,
	stoppedSince: null,
	last: null
});

/** A rest: the 2 h start again, and it may be asked for again. */
function rested(trip: TripState): TripState {
	return { ...trip, sinceBreak: 0, restSaid: false };
}

/** The trip with one more GPS position (`speed` in m/s, if it gives it). */
export function tick(trip: TripState, at: LngLat, speed: number | null, now: number): TripState {
	const last = trip.last;
	if (!last) return { ...trip, last: { at, time: now } };
	const ms = now - last.time;
	if (ms <= 0) return trip;
	if (ms > NEW_TRIP_MS) return { ...newTrip(), last: { at, time: now } };
	let next: TripState = ms >= BREAK_MS ? rested(trip) : { ...trip };
	next.last = { at, time: now };
	const metres = metresBetween(last.at, at);
	const moving = (speed ?? metres / (ms / 1000)) > MOVING;
	if (!moving) {
		next.stoppedSince ??= last.time;
		if (now - next.stoppedSince >= BREAK_MS) next = rested(next);
		return next;
	}
	next.stoppedSince = null;
	if (ms > GAP_MS) return next;
	if (metres / (ms / 1000) < JUMP_SPEED) next.metres += metres;
	next.moving += ms / 1000;
	next.sinceBreak += ms / 1000;
	return next;
}

/** Driving long enough to rest, not asked for yet. */
export const restDue = (trip: TripState) => trip.sinceBreak >= REST_AFTER_SECONDS && !trip.restSaid;

/** As kept in the browser, or a new one if it is not one. */
export function parseTrip(value: unknown): TripState {
	const t = value as Partial<TripState> | null;
	const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
	if (!t || !number(t.metres) || !number(t.moving) || !number(t.sinceBreak)) return newTrip();
	const last =
		t.last &&
		Array.isArray(t.last.at) &&
		t.last.at.length === 2 &&
		t.last.at.every((n) => typeof n === 'number') &&
		number(t.last.time)
			? t.last
			: null;
	return {
		metres: t.metres!,
		moving: t.moving!,
		sinceBreak: t.sinceBreak!,
		restSaid: t.restSaid === true,
		stoppedSince: number(t.stoppedSince) ? t.stoppedSince! : null,
		last
	};
}
