import { expect as want, test } from 'bun:test';
import { addDays } from 'comun/agenda.ts';
import { fuelOutlook, guessedFuel, learnFuel } from './fuel.ts';

/** Units from a day until the next one; the last, going. */
const units = (...days: string[]) =>
	days.map((startedOn, i) => ({ startedOn, endedOn: days[i + 1] ?? null, whole: true }));
const one = (fit: ReturnType<typeof guessedFuel>, startedOn: string | null, heats = true) => [
	{ fit, heats, startedOn }
];

/** Days with the same cold each, from a day on. */
function cold(from: string, days: number, degrees: number, into = new Map<string, number>()) {
	for (let i = 0; i < days; i++) into.set(addDays(from, i), degrees);
	return into;
}

test('each bottle until the next: 10 days at 10 degree-days, 20 at 5: all of it by the cold', () => {
	const degrees = cold('2026-10-01', 10, 10);
	cold('2026-10-11', 20, 5, degrees);
	cold('2026-10-31', 5, 20, degrees);
	const fit = learnFuel(units('2026-10-01', '2026-10-11', '2026-10-31', '2026-11-05'), degrees)!;
	want(fit.n).toBe(3);
	want(fit.base).toBeCloseTo(0, 6);
	want(fit.perDegree).toBeCloseTo(0.01, 6);
});

test('not enough, or not one: too short, too long, without the weather', () => {
	const degrees = cold('2026-01-01', 200, 8);
	want(learnFuel(units('2026-01-01', '2026-01-10'), degrees)).toBeNull();
	// The same day, a day apart, or most of a year: not one.
	want(
		learnFuel(units('2026-01-01', '2026-01-01', '2026-01-02', '2026-11-01'), degrees)
	).toBeNull();
	want(learnFuel(units('2025-12-20', '2026-01-01', '2026-01-10'), degrees)).toBeNull();
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
	const o = fuelOutlook(one(fit, '2026-11-10'), 1, degrees, ahead);
	want(o.spots[0]!.left).toBeCloseTo(0.5, 6);
	// 0,1 a day: the half lasts until the 5th day (19th), with the full one 10 more (29th).
	want(o.spots[0]!.ends).toBe('2026-11-19');
	want(o.allEnds).toBe('2026-11-29');
	want(o.needed.kwh).toBeCloseTo(1.5, 6);
	want(o.toBuy).toBe(0);
	const short = fuelOutlook(one(fit, '2026-11-10'), 0, degrees, ahead);
	want(short.allEnds).toBe('2026-11-19');
	want(short.toBuy).toBe(1);
});

test('none known to be going: nothing left said; warm days: it lasts', () => {
	const fit = { base: 0, perDegree: 0.01, spread: 0, n: 3 };
	const ahead = Array.from({ length: 15 }, (_, i) => ({
		day: addDays('2026-11-15', i),
		degrees: 0
	}));
	const o = fuelOutlook(one(fit, null), 2, new Map(), ahead);
	want([o.spots[0]!.left, o.spots[0]!.ends, o.allEnds, o.toBuy]).toEqual([null, null, null, 0]);
	const warm = fuelOutlook(one(fit, '2026-11-14'), 0, cold('2026-11-14', 1, 0), ahead);
	want([warm.spots[0]!.left, warm.spots[0]!.ends, warm.allEnds]).toEqual([1, null, null]);
});

test('the days without one, or one taken away half full, are not learned from', () => {
	const degrees = cold('2026-10-01', 60, 10);
	// Ran out on the 11th, the next put on the 21st: 10 days each, not 20.
	const gap = [
		{ startedOn: '2026-10-01', endedOn: '2026-10-11', whole: true },
		{ startedOn: '2026-10-21', endedOn: '2026-10-31', whole: true }
	];
	want(1 / learnFuel(gap, degrees)!.base).toBeCloseTo(10, 6);
	want(learnFuel([gap[0]!, { ...gap[1]!, whole: false }], degrees)).toBeNull();
});

test('a cooker: the same every day, whatever the cold, and without the weather', () => {
	const fit = learnFuel(units('2026-06-01', '2026-07-21', '2026-09-09'), new Map(), false)!;
	want(fit.perDegree).toBe(0);
	want(1 / fit.base).toBeCloseTo(50, 6);
	const g = guessedFuel(40, false);
	want([g.base, g.perDegree]).toEqual([1 / 40, 0]);
});

test('two at once: each ends on its day, the full one is for the first, then one is missing', () => {
	const ahead = Array.from({ length: 15 }, (_, i) => ({
		day: addDays('2026-11-15', i),
		degrees: 10
	}));
	const daily = (perDay: number) => ({ base: perDay, perDegree: 0, spread: 0, n: 3 });
	const spots = [
		{ fit: daily(0.25), heats: false, startedOn: '2026-11-15' },
		{ fit: daily(0.1), heats: false, startedOn: '2026-11-15' }
	];
	// The first: 4 days (18th), with the full one 4 more (22nd). The second, 10 days (24th).
	const o = fuelOutlook(spots, 1, new Map(), ahead);
	want(o.spots.map((s) => s.ends)).toEqual(['2026-11-18', '2026-11-24']);
	want(o.allEnds).toBe('2026-11-22');
	want(o.needed.kwh).toBeCloseTo(5.25, 6);
	// 15 days: the first takes 3.75 (2 to buy), the second 1.5 (1 to buy).
	want(o.toBuy).toBe(3);
	// One not going takes nothing.
	const alone = fuelOutlook([spots[1]!, { ...spots[0]!, startedOn: null }], 0, new Map(), ahead);
	want(alone.spots[1]).toEqual({ left: null, ends: null });
	want(alone.toBuy).toBe(1);
});
