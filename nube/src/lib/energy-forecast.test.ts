import { expect as want, test } from 'bun:test';
import { expect, fitLine } from './energy-forecast.ts';

const close = (n: number) => Math.round(n * 100) / 100;

test('a line through days: a base and so much more per degree-day', () => {
	// 2 kWh with no cold, 0,5 more per degree-day.
	const fit = fitLine([0, 4, 8, 12].map((x) => ({ x, y: 2 + 0.5 * x })))!;
	want([close(fit.base), close(fit.perDegree), close(fit.spread), fit.n]).toEqual([2, 0.5, 0, 4]);
});

test('the cold not raising the use, or days all alike: the mean, nothing per degree', () => {
	want(fitLine([0, 5, 10].map((x) => ({ x, y: 6 - x / 10 })))).toMatchObject({
		perDegree: 0,
		base: 5.5
	});
	const alike = fitLine([
		{ x: 3, y: 1 },
		{ x: 3.2, y: 5 }
	])!;
	want([alike.perDegree, alike.base]).toEqual([0, 3]);
});

test('all of it by the cold (it would cross below zero): through zero', () => {
	const fit = fitLine([
		{ x: 2, y: 0 },
		{ x: 10, y: 10 }
	])!;
	want(fit.base).toBe(0);
	want(close(fit.perDegree)).toBe(0.96);
});

test('bills weigh their days', () => {
	const fit = fitLine([
		{ x: 2, y: 4, w: 60 },
		{ x: 10, y: 8, w: 30 },
		{ x: 6, y: 9, w: 1 }
	])!;
	want(close(fit.perDegree)).toBe(0.5);
});

test('expected: the sum over the days, with a range from the spread and the weather', () => {
	const fit = { base: 2, perDegree: 0.5, spread: 1, n: 30 };
	const days = Array.from({ length: 9 }, () => 4);
	const e = expect(fit, days);
	want(e.kwh).toBe(36);
	// spread 1 × √9 = 3; weather 7 × 0,5 + 2 × 1 = 5,5.
	want([e.low, e.high]).toEqual([27.5, 44.5]);
	want(expect({ base: 0.1, perDegree: 0, spread: 5, n: 20 }, [1]).low).toBe(0);
});
