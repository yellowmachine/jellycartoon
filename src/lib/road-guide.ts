import type { LngLat, Route, RouteStep } from '#lib/road.ts';

/**
 * Guidance along a route (#78, phase 3c), from where the GPS says we are: how far along the route,
 * the next maneuver and how far it is, how far off the route, and whether we have arrived. Plain
 * maths on the route's line, no network: done at every position.
 */

const EARTH = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points (haversine). */
export function metresBetween(a: LngLat, b: LngLat) {
	const dLat = rad(b[1] - a[1]);
	const dLon = rad(b[0] - a[0]);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/** For each point of the line, the metres from its start. */
export function alongLine(line: LngLat[]) {
	const along = [0];
	for (let i = 1; i < line.length; i++)
		along.push(along[i - 1]! + metresBetween(line[i - 1]!, line[i]!));
	return along;
}

/**
 * The point of the line nearest to `at`: how far along it is, and how far from it `at` is. Flat
 * maths around `at`, right for the few hundred metres that matter.
 */
export function locate(line: LngLat[], along: number[], at: LngLat) {
	const kx = Math.cos(rad(at[1])) * (Math.PI / 180) * EARTH;
	const ky = (Math.PI / 180) * EARTH;
	const x = (p: LngLat) => (p[0] - at[0]) * kx;
	const y = (p: LngLat) => (p[1] - at[1]) * ky;
	let best = { along: 0, off: Infinity };
	for (let i = 0; i < line.length - 1; i++) {
		const ax = x(line[i]!);
		const ay = y(line[i]!);
		const dx = x(line[i + 1]!) - ax;
		const dy = y(line[i + 1]!) - ay;
		const length = dx * dx + dy * dy;
		// How far along this segment the nearest point is, from 0 (its start) to 1 (its end).
		const t = length ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length)) : 0;
		const off = Math.hypot(ax + t * dx, ay + t * dy);
		if (off < best.off) best = { along: along[i]! + t * (along[i + 1]! - along[i]!), off };
	}
	if (line.length === 1) best = { along: 0, off: Math.hypot(x(line[0]!), y(line[0]!)) };
	return best;
}

/** Closer than this to the end, we have arrived. */
export const ARRIVED_METRES = 30;
/** A maneuver this close behind is still the one we are doing, not past. */
const DOING_METRES = 10;

export interface Guidance {
	/** The next thing to do; null once arrived. */
	next: RouteStep | null;
	/** Its index among the route's steps. */
	nextIndex: number;
	/** Metres to it. */
	toNext: number;
	/** Metres from here to the end. */
	remaining: number;
	/** Metres from here to the route's line. */
	off: number;
	arrived: boolean;
}

export function guide(route: Route, along: number[], at: LngLat): Guidance {
	const here = locate(route.line, along, at);
	const total = along.at(-1) ?? 0;
	const remaining = Math.max(0, total - here.along);
	const nextIndex = route.steps.findIndex(
		(s) => (along[s.index] ?? 0) > here.along - DOING_METRES && s.index > 0
	);
	const arrived = remaining < ARRIVED_METRES;
	const next = arrived || nextIndex < 0 ? null : route.steps[nextIndex]!;
	return {
		next,
		nextIndex,
		toNext: next ? Math.max(0, (along[next.index] ?? 0) - here.along) : 0,
		remaining,
		off: here.off,
		arrived
	};
}
