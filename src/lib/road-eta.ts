import type { Guidance } from './road-guide.ts';
import type { Route } from './road.ts';

/**
 * How long is left, and when we arrive (#78): stretch by stretch with openrouteservice's own
 * reckoning for each (a motorway is quicker than a town), and then as one drives, compared with
 * what it reckoned. It knows nothing of traffic ahead; what was slow behind, it does.
 */

/** Seconds openrouteservice reckons from here: what is left of this step, and all the next. */
export function plannedLeft(route: Route, guidance: Guidance) {
	if (guidance.arrived) return 0;
	const { steps } = route;
	const next = guidance.nextIndex < 0 ? steps.length : guidance.nextIndex;
	const current = steps[next - 1];
	const ofCurrent =
		current && current.distance > 0
			? current.duration * Math.min(1, guidance.toNext / current.distance)
			: 0;
	return ofCurrent + steps.slice(next).reduce((sum, s) => sum + s.duration, 0);
}

/** Moving faster than this (m/s, about 5 km/h): driving, not parked for a coffee. */
const MOVING = 1.5;
/** A gap between positions longer than this is not counted (the GPS lost, the screen off). */
const GAP_MS = 5000;
/** Driven this far before one's own pace counts: a traffic light is not a pace. */
export const PACE_FROM_METRES = 5000;
const PACE_MIN = 0.85;
const PACE_MAX = 1.4;

/**
 * One's pace against openrouteservice's: the time driving (not parked) for what it reckoned for the
 * same stretch. Kept when the route is made again on the way (off it), until the new one has its own.
 */
export class Pace {
	#moving = 0;
	#last: number | null = null;
	#learned = 1;

	/** Each position from the GPS. */
	tick(now: number, speed: number | null) {
		if (this.#last !== null && (speed ?? 0) > MOVING && now - this.#last < GAP_MS)
			this.#moving += (now - this.#last) / 1000;
		this.#last = now;
	}

	/** A new route: to the same place (made again on the way), what was learned stays. */
	restart(sameDestination: boolean) {
		this.#moving = 0;
		this.#last = null;
		if (!sameDestination) this.#learned = 1;
	}

	/** How much slower (over 1) or quicker than reckoned, from what was driven of this route. */
	factor(drivenMetres: number, plannedDriven: number) {
		// Without a minute driving (the GPS quiet a while), nothing to compare with.
		if (drivenMetres < PACE_FROM_METRES || plannedDriven <= 0 || this.#moving < 60)
			return this.#learned;
		this.#learned = Math.min(PACE_MAX, Math.max(PACE_MIN, this.#moving / plannedDriven));
		return this.#learned;
	}
}

/** Seconds left at one's pace, and the arrival's time. */
export function estimate(route: Route, guidance: Guidance, pace: Pace, now = Date.now()) {
	const left = plannedLeft(route, guidance);
	const total = route.steps.reduce((sum, s) => sum + s.duration, 0) || route.duration;
	const factor = pace.factor(route.distance - guidance.remaining, total - left);
	const seconds = left * factor;
	return { seconds, arrival: new Date(now + seconds * 1000) };
}

/** «1 h 25 min», «12 min», «1 min». */
export function durationText(seconds: number) {
	const minutes = Math.max(1, Math.round(seconds / 60));
	return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
