import { expect as want, test } from 'bun:test';
import { addDays } from 'comun/agenda.ts';
import { fuelOutlook, guessedFuel, learnFuel } from './fuel.ts';

/** Days with the same cold each, from a day on. */
function cold(from: string, days: number, degrees: number, into = new Map<string, number>()) {
	for (let i = 0; i < days; i++) into.set(addDays(from, i), degrees);
	return into;
}

test('each bottle until the next: 10 days at 10 degree-days, 20 at 5: all of it by the cold', () => {
	const degrees = cold('2026-10-01', 10, 10);
	cold('2026-10-11', 20, 5, degrees);
	cold('2026-10-31', 5, 20, degrees);
	const fit = learnFuel(['2026-10-01', '2026-10-11', '2026-10-31', '2026-11-05'], degrees)!;
	want(fit.n).toBe(3);
	want(fit.base).toBeCloseTo(0, 6);
	want(fit.perDegree).toBeCloseTo(0.01, 6);
});

test('not enough, or not one: too short, too long, without the weather', () => {
	const degrees = cold('2026-01-01', 200, 8);
	want(learnFuel(['2026-01-01', '2026-01-10'], degrees)).toBeNull();
	// The same day twice counts once; a day apart, or half a year, is not one.
	want(learnFuel(['2026-01-01', '2026-01-01', '2026-01-02', '2026-06-01'], degrees)).toBeNull();
	want(learnFuel(['2025-12-20', '2026-01-01', '2026-01-10'], degrees)).toBeNull();
});

test('a guess: «in winter it lasts 12 days» is 12 days at 10 degree-days', () => {
	const fit = guessedFuel(12);
	want(1 / (fit.base + fit.perDegree * 10)).toBeCloseTo(12, 6);
});

test('the one going: what is left, when it ends, when all end, how many to buy', () => {
	const fit = { base: 0, perDegree: 0.01, spread: 0, n: 3 };
	// Started 5 days ago at 10 degree-days: half gone.
	const degrees = cold('2026-11-10', 5, 10);
	const ahead = Array.from({ length: 15 }, (_, i) => ({
		day: addDays('2026-11-15', i),
		degrees: 10
	}));
	const o = fuelOutlook(fit, '2026-11-10', 1, degrees, ahead);
	want(o.left).toBeCloseTo(0.5, 6);
	// 0,1 a day: the half lasts until the 5th day (19th), with the full one 10 more (29th).
	want(o.currentEnds).toBe('2026-11-19');
	want(o.allEnds).toBe('2026-11-29');
	want(o.needed.kwh).toBeCloseTo(1.5, 6);
	want(o.toBuy).toBe(0);
	const short = fuelOutlook(fit, '2026-11-10', 0, degrees, ahead);
	want(short.allEnds).toBe('2026-11-19');
	want(short.toBuy).toBe(1);
});

test('none known to be going: nothing left said; warm days: it lasts', () => {
	const fit = { base: 0, perDegree: 0.01, spread: 0, n: 3 };
	const ahead = Array.from({ length: 15 }, (_, i) => ({
		day: addDays('2026-11-15', i),
		degrees: 0
	}));
	const o = fuelOutlook(fit, null, 2, new Map(), ahead);
	want([o.left, o.currentEnds, o.allEnds, o.toBuy]).toEqual([null, null, null, 0]);
	const warm = fuelOutlook(fit, '2026-11-14', 0, cold('2026-11-14', 1, 0), ahead);
	want([warm.left, warm.currentEnds, warm.allEnds]).toEqual([1, null, null]);
});
