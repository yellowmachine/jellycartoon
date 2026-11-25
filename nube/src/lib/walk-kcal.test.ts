import { expect, test } from 'bun:test';
import { addKcal, footWeeks, kcalText, walkKcal, weightFromText, weightOn } from './walk-kcal.ts';

test('a weight as written', () => {
	expect(weightFromText('72,5')).toBe(72.5);
	expect(weightFromText(' 80 kg ')).toBe(80);
	for (const bad of ['', '7', '400', '72,55', 'mucho', '-70'])
		expect(weightFromText(bad)).toBeNull();
});

test('the weight of a day: the last one noted by then; before the first, the first', () => {
	const weights = [
		{ day: '2026-11-10', kg: 78 },
		{ day: '2026-10-01', kg: 80 }
	];
	expect(weightOn(weights, '2026-09-01')).toBe(80);
	expect(weightOn(weights, '2026-11-09')).toBe(80);
	expect(weightOn(weights, '2026-11-10')).toBe(78);
	expect(weightOn([], '2026-11-10')).toBeNull();
});

test('walking, running, and what is not on foot', () => {
	// 5 km in an hour, 75 kg.
	expect(walkKcal(5000, 3600, 75)).toBeCloseTo(187.5);
	// 10 km in an hour.
	expect(walkKcal(10_000, 3600, 75)).toBeCloseTo(750);
	expect(walkKcal(25_000, 3600, 75)).toBeNull();
	expect(walkKcal(5000, 3600, null)).toBeNull();
	expect(walkKcal(5000, 0, 75)).toBeNull();
	expect(kcalText(187.5)).toBe('≈\u00a0190\u00a0kcal');
});

test('by week; none known, null', () => {
	expect(addKcal([null, 10, 5])).toBe(15);
	expect(addKcal([null])).toBeNull();
	expect(
		footWeeks(
			['2026-11-09', '2026-11-16'],
			[
				{ week: '2026-11-16', distance: 2000, kcal: 75 },
				{ week: '2026-11-16', distance: 1000, kcal: null },
				{ week: '2026-01-05', distance: 9000, kcal: 300 }
			]
		)
	).toEqual([
		{ week: '2026-11-09', km: 0, kcal: null },
		{ week: '2026-11-16', km: 3, kcal: 75 }
	]);
});
