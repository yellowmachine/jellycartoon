import { metresBetween } from 'comun/road-guide.ts';
import { WALKING } from './owntracks-walking.ts';

/**
 * OwnTracks (#593): a phone left on all day sends where it is again and again without moving. Of a
 * while standing still only its first position and its last are kept: the last, so that leaving
 * is measured from when one left, and what the page says came last is so.
 */
export const STILL = {
	/** Metres from the first one, always: from the one before, walking slowly would be still. */
	radius: 30,
	/** An inaccurate one (indoors) may be as far as its accuracy, up to this. */
	widest: 100
};

export interface PlacedPoint {
	lon: number;
	lat: number;
	/** Metres. */
	accuracy: number | null;
}

/** Whether a position is too inaccurate to say where, as for the walking sums. */
export const inaccurate = (p: PlacedPoint) =>
	p.accuracy !== null && p.accuracy > WALKING.worstAccuracy;

/** Whether `p` is where `first` was. */
export function stillAt(first: PlacedPoint, p: PlacedPoint) {
	const radius = inaccurate(p) ? Math.min(p.accuracy!, STILL.widest) : STILL.radius;
	return metresBetween([first.lon, first.lat], [p.lon, p.lat]) <= radius;
}
