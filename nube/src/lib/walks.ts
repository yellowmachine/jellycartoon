import { metresBetween } from 'comun/road-guide.ts';
import { isTripPoint, type TripPoint } from '#lib/trips.ts';

/**
 * Paseos (#410): what the browser keeps of the GPS while walking and what the server makes of it.
 * Shared, and plain maths, to be tested.
 */

/** A point is kept once we have moved this far: closer than the road mode's, as walking is slow. */
export const KEEP_EVERY_METRES = 10;
/** Positions worse than this are left out: their wobble would add up to km not walked. */
export const WORST_ACCURACY_METRES = 30;
/** Faster than this between two points (36 km/h) is the GPS jumping, not someone walking. */
export const FASTEST_WALK = 10;
/** This long without a position from the GPS is a gap, which counts as a straight line. */
export const GAP_AFTER_MS = 30_000;
/** A walk's positions at most: over 50 km, and what fits in one request. */
export const MAX_POINTS = 5000;

/** A time the GPS said nothing. */
export interface WalkGap {
	/** When it started, in seconds since 1970. */
	at: number;
	seconds: number;
	/** Between its two ends, in a straight line. */
	metres: number;
	/** Whether the screen was off at some moment of it. */
	hidden: boolean;
	/** Whether music was playing when it started. */
	music: boolean;
	/** Whether the page had to be opened again: the phone had closed it. */
	reopened: boolean;
}

/** What the GPS did in a walk: whether it goes on with the screen off, with music and without. */
export interface WalkDiagnosis {
	/** Positions the GPS gave, kept or not. */
	fixes: number;
	/** Of them, with the screen off. */
	hiddenFixes: number;
	/** Of them, with music playing. */
	musicFixes: number;
	/** How long the screen was off. */
	hiddenSeconds: number;
	gaps: WalkGap[];
}

export const noDiagnosis = (): WalkDiagnosis => ({
	fixes: 0,
	hiddenFixes: 0,
	musicFixes: 0,
	hiddenSeconds: 0,
	gaps: []
});

/** Whether the browser keeps this position: never closer than its own error, to not add wobble. */
export function worthWalking(last: TripPoint | null, next: TripPoint, accuracy: number | null) {
	if (accuracy !== null && accuracy > WORST_ACCURACY_METRES) return false;
	return !last || metresBetween(last.at, next.at) >= Math.max(KEEP_EVERY_METRES, accuracy ?? 0);
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

const isGap = (g: unknown): g is WalkGap => {
	const q = g as WalkGap | null;
	return (
		isCount(q?.at) &&
		isCount(q.seconds) &&
		isCount(q.metres) &&
		typeof q.hidden === 'boolean' &&
		typeof q.music === 'boolean' &&
		typeof q.reopened === 'boolean'
	);
};

/** A finished walk as the browser sends it, or null if it is not one. */
export function parseWalk(body: unknown) {
	const b = body as {
		startedAt?: unknown;
		endedAt?: unknown;
		points?: unknown;
		diagnosis?: Partial<WalkDiagnosis>;
	} | null;
	const d = b?.diagnosis;
	if (
		!isCount(b?.startedAt) ||
		!isCount(b.endedAt) ||
		b.endedAt < b.startedAt ||
		!Array.isArray(b.points) ||
		!isCount(d?.fixes) ||
		!isCount(d.hiddenFixes) ||
		!isCount(d.musicFixes) ||
		!isCount(d.hiddenSeconds) ||
		!Array.isArray(d.gaps)
	)
		return null;
	const diagnosis: WalkDiagnosis = {
		fixes: d.fixes,
		hiddenFixes: d.hiddenFixes,
		musicFixes: d.musicFixes,
		hiddenSeconds: d.hiddenSeconds,
		gaps: d.gaps.filter(isGap).slice(0, 500)
	};
	return {
		startedAt: new Date(b.startedAt),
		endedAt: new Date(b.endedAt),
		points: b.points.filter(isTripPoint).slice(0, MAX_POINTS),
		diagnosis
	};
}

/** «3,42 km», «850 m»: closer than the road's, as a walk is short. */
export const walkDistanceText = (metres: number) =>
	metres >= 1000
		? `${(metres / 1000).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
		: `${Math.round(metres)} m`;

/** «12:05», «1:02:05»: the clock of a walk going on. */
export function clockText(seconds: number) {
	const s = Math.max(0, Math.floor(seconds));
	const two = (n: number) => String(n).padStart(2, '0');
	const h = Math.floor(s / 3600);
	const m = Math.floor(s / 60) % 60;
	return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** «11:30 min/km»; nothing until it has walked enough for it to mean something. */
export function paceText(metres: number, seconds: number) {
	if (metres < 50 || seconds <= 0) return null;
	return `${clockText((seconds / metres) * 1000)} min/km`;
}

/** The Monday of a day's week, both `YYYY-MM-DD`. */
export function mondayOf(day: string) {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** This week's and this month's walks, added up; `day`, each one's, as `today`. */
export function walkTotals(
	walks: { day: string; distance: number; seconds: number }[],
	today: string
) {
	const add = (from: string) => {
		const those = walks.filter((w) => w.day >= from && w.day <= today);
		return {
			walks: those.length,
			distance: those.reduce((sum, w) => sum + w.distance, 0),
			seconds: those.reduce((sum, w) => sum + w.seconds, 0)
		};
	};
	return { week: add(mondayOf(today)), month: add(`${today.slice(0, 7)}-01`) };
}
