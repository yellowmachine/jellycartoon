import { addDays } from 'comun/agenda.ts';
import { expect, fitLine, type Expected, type Fit } from './energy-forecast.ts';

/**
 * Butane and pellet (Energía → Previsión, #513 phase 2): what comes in units. Each unit
 * says, by its days, how long one lasted with the cold of those days: the same line as the light
 * (energy-forecast.ts), in units a day. Several can be going at once, each in its spot (#628), which
 * learns its own: the stove by the cold, the cooker not.
 */

export const FUEL_KINDS = {
	butano: {
		name: 'Butano',
		icon: '🔥',
		unit: 'bombona',
		units: 'bombonas',
		/** What an expense in Dinero says when it is one (its shop or a line), accents aside. */
		words: ['butano', 'bombona'],
		startsOnBuy: true
	},
	pellet: {
		name: 'Pellet',
		icon: '🪵',
		unit: 'saco',
		units: 'sacos',
		words: ['pellet', 'pelet'],
		startsOnBuy: false
	}
} as const;
export type FuelKind = keyof typeof FUEL_KINDS;
export const isFuelKind = (v: unknown): v is FuelKind =>
	typeof v === 'string' && Object.hasOwn(FUEL_KINDS, v);

/** Units lasted, at least, to learn from. */
export const MIN_UNITS = 2;
/** A unit lasting less or more than this is not one (forgotten, or bought twice the same day). */
const SHORTEST = 2;
const LONGEST = 200;
/** Gone, a hair above none: sums of fractions are not exact. */
const EMPTY = 1e-9;
/** A winter's day, in heating degree-days (a mean of 8 °C): what «in winter it lasts…» means. */
export const WINTER_DEGREES = 10;

const daysBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** A unit put on: since when, and until when (null, going). */
export interface UnitDays {
	startedOn: string;
	endedOn: string | null;
	whole: boolean;
}

/** How many of them say how long one lasts: ended, all used, and neither too short nor too long. */
export const wholeUnits = (units: UnitDays[]) =>
	units.filter((u) => {
		if (!u.endedOn || !u.whole) return false;
		const n = daysBetween(u.startedOn, u.endedOn);
		return n >= SHORTEST && n <= LONGEST;
	});

/**
 * What a spot's units say: each one's days and its cold (`degrees` of each day; a day without it
 * leaves that unit out). Without `heats`, the cold is nothing to it.
 */
export function learnFuel(units: UnitDays[], degrees: Map<string, number>, heats = true) {
	const points: { x: number; y: number; w: number }[] = [];
	for (const u of wholeUnits(units)) {
		const n = daysBetween(u.startedOn, u.endedOn!);
		let cold = 0;
		let known = true;
		if (heats)
			for (let d = u.startedOn; d < u.endedOn!; d = addDays(d, 1)) {
				const c = degrees.get(d);
				if (c === undefined) known = false;
				cold += c ?? 0;
			}
		if (known) points.push({ x: cold / n, y: 1 / n, w: n });
	}
	return points.length >= MIN_UNITS ? fitLine(points) : null;
}

/**
 * Until it is learned: what the family said one lasts, in winter and all of it by the cold if it
 * heats; if not, each day the same.
 */
export const guessedFuel = (guessDays: number, heats = true): Fit => ({
	base: heats ? 0 : 1 / guessDays,
	perDegree: heats ? 1 / (guessDays * WINTER_DEGREES) : 0,
	spread: 0.25 / guessDays,
	n: 0
});

export interface SpotUse {
	fit: Fit;
	heats: boolean;
	/** The day the one going was put on; null, none going. */
	startedOn: string | null;
}

export interface FuelOutlook {
	/** Of each spot, in order: what is left of the one going (0 to 1; null, none), and its end. */
	spots: { left: number | null; ends: string | null }[];
	/** The first day a spot is left with none, nothing full at home; null, not within the days. */
	allEnds: string | null;
	/** Units the next days take, and how many to buy beyond what is at home. */
	needed: Expected;
	toBuy: number;
}

/**
 * The spots with one going, `full` more at home for any of them, and the next days' cold (`ahead`,
 * today first; the days gone, in `degrees`). One that runs out takes a full one at once.
 */
export function fuelOutlook(
	spots: SpotUse[],
	full: number,
	degrees: Map<string, number>,
	ahead: { day: string; degrees: number }[]
): FuelOutlook {
	const rate = (s: SpotUse, cold: number) => s.fit.base + (s.heats ? s.fit.perDegree * cold : 0);
	const today = ahead[0]?.day ?? null;
	let stock = full;
	let allEnds: string | null = null;
	let toBuy = 0;
	const state = spots.map((s) => {
		if (!s.startedOn || !today) return { use: s, left: null, now: 0, ends: null as string | null };
		let used = 0;
		for (let d = s.startedOn; d < today; d = addDays(d, 1)) used += rate(s, degrees.get(d) ?? 0);
		const left = Math.max(0, 1 - used);
		return { use: s, left, now: left, ends: left <= EMPTY ? today : (null as string | null) };
	});
	const going = state.filter((s) => s.left !== null);
	const refill = (s: (typeof state)[number], day: string) => {
		while (s.now <= EMPTY && stock > 0) {
			stock--;
			s.now++;
		}
		if (s.now <= EMPTY) allEnds ??= day;
	};
	for (const a of ahead)
		for (const s of going) {
			refill(s, a.day);
			const use = rate(s.use, a.degrees);
			if (use <= 0) continue;
			// What is needed and is not there has to be bought.
			if (s.now <= EMPTY) {
				toBuy++;
				s.now++;
			}
			s.now -= use;
			while (s.now < -EMPTY) {
				refill(s, a.day);
				if (s.now >= -EMPTY) break;
				toBuy++;
				s.now++;
			}
			if (s.now <= EMPTY) {
				s.ends ??= a.day;
				refill(s, a.day);
			}
		}
	const each = going.map((s) =>
		expect(
			s.use.fit,
			ahead.map((a) => (s.use.heats ? a.degrees : 0))
		)
	);
	const sum = (pick: (e: Expected) => number) => each.reduce((t, e) => t + pick(e), 0);
	return {
		spots: state.map(({ left, ends }) => ({ left, ends })),
		allEnds,
		needed: { kwh: sum((e) => e.kwh), low: sum((e) => e.low), high: sum((e) => e.high) },
		toBuy
	};
}
