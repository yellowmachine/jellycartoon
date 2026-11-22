import { metresBetween } from 'comun/road-guide.ts';
import type { StoredPoint } from '#lib/trips.ts';

/**
 * OwnTracks (#593, phase 2): from a day's positions, when one was walking. Between two positions,
 * a stretch walking is one at a walking pace, measured between them (and the phone's own speed,
 * when it sends one, not a car's), close enough in time, with positions accurate enough. Stretches
 * one after another make an outing; a short stop (a traffic light) does not end it. What overlaps
 * a walk recorded in the app is left out: it is that walk's, so nothing counts twice.
 */

export interface TrackPoint {
	at: Date;
	lon: number;
	lat: number;
	/** Metres. */
	accuracy: number | null;
	/** km/h, the phone's. */
	speed: number | null;
}

export interface Outing {
	startedAt: Date;
	endedAt: Date;
	/** Metres walking. */
	distance: number;
	line: StoredPoint[];
}

export const WALKING = {
	/** Positions less accurate than this are not used. */
	worstAccuracy: 50,
	/** km/h between two positions: slower is standing still, faster is not on foot. */
	slowest: 1.5,
	fastest: 7.5,
	/** km/h the phone itself says: more, not on foot (a car at a light, measured slow). */
	phoneFastest: 10,
	/**
	 * Seconds between two positions at most: OwnTracks' Significant sends one every 15 minutes
	 * walking; more, and what was done in between is not known.
	 */
	longestGap: 20 * 60,
	/** A stop shorter than this, in the middle of an outing, does not end it. */
	shortStop: 3 * 60,
	/** Outings shorter than this are not counted: moving about at home, the GPS wandering. */
	shortest: 300
};

const overlaps = (from: number, to: number, walks: { startedAt: Date; endedAt: Date }[]) =>
	walks.some((w) => from < w.endedAt.getTime() && to > w.startedAt.getTime());

const stored = (p: TrackPoint): StoredPoint => [p.lon, p.lat, Math.round(p.at.getTime() / 1000)];

/** The outings walking among those positions, in order, without the app's walks. */
export function walkingOutings(
	points: TrackPoint[],
	appWalks: { startedAt: Date; endedAt: Date }[] = [],
	w = WALKING
): Outing[] {
	const good = points
		.filter((p) => p.accuracy === null || p.accuracy <= w.worstAccuracy)
		.sort((a, b) => a.at.getTime() - b.at.getTime());
	const outings: Outing[] = [];
	let current: Outing | null = null;
	const close = () => {
		if (current && current.distance >= w.shortest) outings.push(current);
		current = null;
	};
	for (let i = 1; i < good.length; i++) {
		const a = good[i - 1]!;
		const b = good[i]!;
		const from = a.at.getTime();
		const to = b.at.getTime();
		const seconds = (to - from) / 1000;
		if (seconds <= 0) continue;
		const metres = metresBetween([a.lon, a.lat], [b.lon, b.lat]);
		const kmh = (metres / seconds) * 3.6;
		const usable = seconds <= w.longestGap && !overlaps(from, to, appWalks);
		const phoneFast = (a.speed ?? 0) > w.phoneFastest || (b.speed ?? 0) > w.phoneFastest;
		if (usable && !phoneFast && kmh >= w.slowest && kmh <= w.fastest) {
			current ??= { startedAt: a.at, endedAt: a.at, distance: 0, line: [stored(a)] };
			current.distance += metres;
			current.endedAt = b.at;
			current.line.push(stored(b));
		} else if (!(current && usable && kmh < w.slowest && seconds <= w.shortStop)) {
			close();
		}
	}
	close();
	return outings;
}
