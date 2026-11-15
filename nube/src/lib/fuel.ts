import { addDays } from 'comun/agenda.ts';
import { expect, fitLine, type Expected, type Fit } from './energy-forecast.ts';

/**
 * Butane and pellet (Energía → Previsión, #513 phase 2): what comes in units. Each unit started
 * and the next one started say how long one lasted with the cold of those days: the same line as
 * the light (energy-forecast.ts), in units a day.
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
const LONGEST = 120;
/** Gone, a hair above none: sums of fractions are not exact. */
const EMPTY = 1e-9;
/** A winter's day, in heating degree-days (a mean of 8 °C): what «in winter it lasts…» means. */
export const WINTER_DEGREES = 10;

const daysBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * What the units started on `starts` (days) say: each one until the next, its days and its cold
 * (`degrees` of each day; a day without it leaves that unit out).
 */
export function learnFuel(starts: string[], degrees: Map<string, number>): Fit | null {
	const days = [...new Set(starts)].sort();
	const points: { x: number; y: number; w: number }[] = [];
	for (let i = 1; i < days.length; i++) {
		const from = days[i - 1]!;
		const n = daysBetween(from, days[i]!);
		if (n < SHORTEST || n > LONGEST) continue;
		let cold = 0;
		let known = true;
		for (let d = from; d < days[i]!; d = addDays(d, 1)) {
			const c = degrees.get(d);
			if (c === undefined) known = false;
			cold += c ?? 0;
		}
		if (known) points.push({ x: cold / n, y: 1 / n, w: n });
	}
	return points.length >= MIN_UNITS ? fitLine(points) : null;
}

/** Until it is learned: what the family said one lasts in winter, all of it by the cold. */
export const guessedFuel = (guessDays: number): Fit => ({
	base: 0,
	perDegree: 1 / (guessDays * WINTER_DEGREES),
	spread: 0.25 / guessDays,
	n: 0
});

export interface FuelOutlook {
	/** Of the one going, what is left (0 to 1); null if none is known to be going. */
	left: number | null;
	/** The day the one going runs out, and the day all at home do; null, not within the days. */
	currentEnds: string | null;
	allEnds: string | null;
	/** Units the next days take, and how many to buy beyond what is at home. */
	needed: Expected;
	toBuy: number;
}

/**
 * With `fit`, the one going started on `startedOn` (its days until yesterday in `degrees`),
 * `full` more at home, and the next days' cold (`ahead`, today first).
 */
export function fuelOutlook(
	fit: Fit,
	startedOn: string | null,
	full: number,
	degrees: Map<string, number>,
	ahead: { day: string; degrees: number }[]
): FuelOutlook {
	const rate = (cold: number) => fit.base + fit.perDegree * cold;
	let left: number | null = null;
	if (startedOn && ahead.length) {
		let used = 0;
		for (let d = startedOn; d < ahead[0]!.day; d = addDays(d, 1)) used += rate(degrees.get(d) ?? 0);
		left = Math.max(0, 1 - used);
	}
	let stock = (left ?? 0) + full;
	let current = left ?? 0;
	let currentEnds: string | null =
		left === null ? null : left <= EMPTY ? (ahead[0]?.day ?? null) : null;
	let allEnds: string | null = stock <= EMPTY ? (ahead[0]?.day ?? null) : null;
	for (const a of ahead) {
		const use = rate(a.degrees);
		if (!currentEnds && left !== null && current - use <= EMPTY) currentEnds = a.day;
		current -= use;
		if (!allEnds && stock - use <= EMPTY) allEnds = a.day;
		stock -= use;
	}
	const needed = expect(
		fit,
		ahead.map((a) => a.degrees)
	);
	return {
		left,
		currentEnds,
		allEnds,
		needed,
		toBuy: Math.max(0, Math.ceil(needed.kwh - (left ?? 0) - full - 1e-9))
	};
}
