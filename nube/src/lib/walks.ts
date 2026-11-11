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

/** How often the voice says how it goes (#416). */
export const CUE_EVERY = { km: 'Cada km', '5min': 'Cada 5 minutos', '10min': 'Cada 10 minutos' };
export type CueEvery = keyof typeof CUE_EVERY;

/** What the walk is for: a time or a distance, chosen from a few. */
export interface WalkGoal {
	kind: 'minutes' | 'km';
	value: number;
}
export const WALK_GOALS: WalkGoal[] = [
	...[15, 30, 45, 60, 90].map((value) => ({ kind: 'minutes' as const, value })),
	...[2, 3, 5, 8, 10].map((value) => ({ kind: 'km' as const, value }))
];
export const goalKey = (g: WalkGoal) => `${g.kind}:${g.value}`;
export const goalText = (g: WalkGoal) => `${g.value} ${g.kind === 'km' ? 'km' : 'min'}`;

/** What is chosen before starting; remembered on the device for the next walk. */
export interface WalkPlan {
	every: CueEvery | null;
	goal: WalkGoal | null;
}
export const noPlan = (): WalkPlan => ({ every: null, goal: null });

/** One kept on the device, as far as it is still valid. */
export function parsePlan(kept: unknown): WalkPlan {
	const p = (kept ?? {}) as Partial<WalkPlan>;
	const key = p.goal && goalKey(p.goal);
	return {
		every: typeof p.every === 'string' && Object.hasOwn(CUE_EVERY, p.every) ? p.every : null,
		goal: WALK_GOALS.find((g) => goalKey(g) === key) ?? null
	};
}

/** What the voice has already said of a walk, so as not to say it again. */
export interface WalkCues {
	/** The last km or period said. */
	marks: number;
	half: boolean;
	reached: boolean;
}
export const noCues = (): WalkCues => ({ marks: 0, half: false, reached: false });

/** «1,2 kilómetros», «1 kilómetro», «800 metros»: to be heard. */
export function spokenDistance(metres: number) {
	if (metres < 1000) return `${Math.round(metres / 10) * 10} metros`;
	const km = Math.round(metres / 100) / 10;
	return km === 1 ? '1 kilómetro' : `${km.toLocaleString('es-ES')} kilómetros`;
}

/** «1 hora y 5 minutos», «1 minuto». */
export function spokenTime(seconds: number) {
	const total = Math.floor(seconds / 60);
	const minutes = total % 60;
	const said = minutes === 1 ? '1 minuto' : `${minutes} minutos`;
	if (total < 60) return said;
	const hours = Math.floor(total / 60);
	const inHours = hours === 1 ? '1 hora' : `${hours} horas`;
	return minutes ? `${inHours} y ${said}` : inHours;
}

/** How far along the goal is, from 0; 1 is there. */
function goalShare(goal: WalkGoal, metres: number, seconds: number) {
	return goal.kind === 'km' ? metres / (goal.value * 1000) : seconds / (goal.value * 60);
}

/**
 * What the voice has to say now, if anything, and what is then already said. One thing at a time:
 * reaching the goal is said over the half of it (the GPS came back late), and either of them over
 * a km or a period, as they say how it goes too. Marks passed meanwhile are not said one by one.
 */
export function dueCue(plan: WalkPlan, done: WalkCues, metres: number, seconds: number) {
	const next = { ...done };
	const share = plan.goal ? goalShare(plan.goal, metres, seconds) : 0;
	const marks =
		plan.every === 'km'
			? Math.floor(metres / 1000)
			: plan.every
				? Math.floor(seconds / (plan.every === '5min' ? 300 : 600))
				: 0;
	const newMark = marks > done.marks;
	next.marks = Math.max(done.marks, marks);
	const inTime = `${spokenTime(seconds)}, ${spokenDistance(metres)}`;
	if (share >= 1 && !done.reached) {
		next.reached = true;
		next.half = true;
		return { text: `Objetivo conseguido: ${inTime}.`, cues: next };
	}
	if (share >= 0.5 && !done.half) {
		next.half = true;
		return { text: `Mitad del objetivo: ${inTime}. Puedes dar la vuelta.`, cues: next };
	}
	if (!newMark) return { text: null, cues: next };
	return {
		text:
			plan.every === 'km'
				? `${spokenDistance(metres)}, ${spokenTime(seconds)}.`
				: `${spokenTime(seconds)}, ${spokenDistance(metres)}.`,
		cues: next
	};
}

/** «Faltan 12 min», «Faltan 1,20 km»; null, reached. */
export function goalLeftText(goal: WalkGoal, metres: number, seconds: number) {
	if (goalShare(goal, metres, seconds) >= 1) return null;
	return goal.kind === 'km'
		? `Faltan ${walkDistanceText(goal.value * 1000 - metres)}`
		: `Faltan ${Math.ceil(goal.value - seconds / 60)} min`;
}

/** The copy of a walk's photo kept on the phone: «paseo-2026-11-06-10-32-05.jpg», as it came. */
export function photoCopyName(at: Date, original: string) {
	const two = (n: number) => String(n).padStart(2, '0');
	const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
	const time = `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
	const ext = /\.([a-z0-9]{1,5})$/i.exec(original)?.[1]?.toLowerCase() ?? 'jpg';
	return `paseo-${day}-${time}.${ext}`;
}
