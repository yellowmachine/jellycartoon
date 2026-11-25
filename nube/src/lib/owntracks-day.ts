import { metresBetween } from 'comun/road-guide.ts';
import type { StoredPoint } from '#lib/trips.ts';
import { WALKING, type Outing, type TrackPoint } from '#lib/owntracks-walking.ts';

/**
 * A day of OwnTracks in stretches (#613, phase 2): walking (as owntracks-walking.ts counts it, not
 * worked out again), by vehicle, or moved without knowing how; standing still is none of them. With
 * a position every 15 minutes a bike and a traffic jam look the same: rather unknown than wrong.
 */

export type StretchKind = 'pie' | 'vehiculo' | 'duda';

export interface Stretch {
	kind: StretchKind;
	startedAt: Date;
	endedAt: Date;
	/** Metres. */
	distance: number;
	line: StoredPoint[];
}

export const MOVING = {
	/** km/h, measured or the phone's: faster than anyone walks or runs for long. */
	vehicle: 15,
	/** A move shorter than this between two positions may be only the GPS. */
	shortestMove: 100,
	/** A stop shorter than this (a jam, a light) does not end a stretch. */
	shortStop: 5 * 60,
	/** Stretches shorter than this are not shown. */
	shortest: 300,
	/** From a single pair of positions, shorter than this may be one wrong position: unknown. */
	surePair: 1000
};

const stored = (p: TrackPoint): StoredPoint => [p.lon, p.lat, Math.round(p.at.getTime() / 1000)];

interface Run {
	points: TrackPoint[];
	distance: number;
	/** Metres gone surely by vehicle. */
	fast: number;
	pairs: number;
	/** Where its last move ended: the stop after it is not its own. */
	moved: number;
}

/** Between the outings walking and the app's walks, the rest of the day's moves; all in order. */
export function dayStretches(
	points: TrackPoint[],
	outings: Outing[],
	appWalks: { startedAt: Date; endedAt: Date }[] = [],
	m = MOVING
): Stretch[] {
	const good = points
		.filter((p) => p.accuracy === null || p.accuracy <= WALKING.worstAccuracy)
		.sort((a, b) => a.at.getTime() - b.at.getTime());
	const taken = [...outings, ...appWalks].map((s) => [s.startedAt.getTime(), s.endedAt.getTime()]);
	const found: Stretch[] = outings.map((o) => ({ kind: 'pie', ...o }));
	let run: Run | null = null;
	const close = () => {
		if (run && run.distance >= m.shortest) {
			const line = run.points.slice(0, run.moved + 1);
			const sure = run.fast >= run.distance / 2 && (run.pairs > 1 || run.distance >= m.surePair);
			found.push({
				kind: sure ? 'vehiculo' : 'duda',
				startedAt: line[0]!.at,
				endedAt: line.at(-1)!.at,
				distance: run.distance,
				line: line.map(stored)
			});
		}
		run = null;
	};
	for (let i = 1; i < good.length; i++) {
		const a = good[i - 1]!;
		const b = good[i]!;
		const from = a.at.getTime();
		const to = b.at.getTime();
		const seconds = (to - from) / 1000;
		if (seconds <= 0) continue;
		if (taken.some(([start, end]) => from < end! && to > start!)) {
			close();
			continue;
		}
		const metres = metresBetween([a.lon, a.lat], [b.lon, b.lat]);
		const kmh = (metres / seconds) * 3.6;
		if (metres < m.shortestMove && kmh < m.vehicle) {
			// Still: part of the run only if it moves on soon.
			if (run && (to - run.points[run.moved]!.at.getTime()) / 1000 <= m.shortStop)
				run.points.push(b);
			else close();
			continue;
		}
		run ??= { points: [a], distance: 0, fast: 0, pairs: 0, moved: 0 };
		run.points.push(b);
		run.distance += metres;
		run.pairs++;
		run.moved = run.points.length - 1;
		// Over a long gap too: at that pace on average, it was not on foot.
		if (kmh > m.vehicle || Math.min(a.speed ?? 0, b.speed ?? 0) > m.vehicle) run.fast += metres;
	}
	close();
	return found.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/** Further apart in time, where one was between two positions is not known, unless they are near. */
const KNOWN_GAP = 20 * 60_000;
const SAME_PLACE = 100;

/** Where one was at a moment by the day's positions; null, not known. */
export function whereAt(points: TrackPoint[], at: Date): [number, number] | null {
	const t = at.getTime();
	let before: TrackPoint | null = null;
	let after: TrackPoint | null = null;
	for (const p of points) {
		if (p.accuracy !== null && p.accuracy > WALKING.worstAccuracy) continue;
		const pt = p.at.getTime();
		if (pt <= t && (!before || pt > before.at.getTime())) before = p;
		if (pt >= t && (!after || pt < after.at.getTime())) after = p;
	}
	if (!before || !after) {
		const only = before ?? after;
		return only && Math.abs(only.at.getTime() - t) <= KNOWN_GAP / 2 ? [only.lon, only.lat] : null;
	}
	const gap = after.at.getTime() - before.at.getTime();
	if (!gap) return [before.lon, before.lat];
	const near = metresBetween([before.lon, before.lat], [after.lon, after.lat]) <= SAME_PLACE;
	if (gap > KNOWN_GAP && !near) return null;
	const part = (t - before.at.getTime()) / gap;
	return [
		before.lon + (after.lon - before.lon) * part,
		before.lat + (after.lat - before.lat) * part
	];
}

/** The stretch a moment is in: its place in the list; null, none. */
export function stretchAt(stretches: { startedAt: Date; endedAt: Date }[], at: Date) {
	const t = at.getTime();
	const i = stretches.findIndex((s) => s.startedAt.getTime() <= t && t <= s.endedAt.getTime());
	return i < 0 ? null : i;
}
