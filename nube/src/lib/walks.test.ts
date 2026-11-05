import { describe, expect, test } from 'bun:test';
import { addPoints, type TripPoint } from '#lib/trips.ts';
import {
	FASTEST_WALK,
	clockText,
	mondayOf,
	noDiagnosis,
	paceText,
	parseWalk,
	walkDistanceText,
	walkTotals,
	worthWalking
} from '#lib/walks.ts';

const at = (north: number, t = 0): TripPoint => ({
	t,
	at: [-1.1, 37.9 + north / 111_195],
	speed: null
});

describe('which positions a walk keeps', () => {
	test('the first, if good enough', () => {
		expect(worthWalking(null, at(0), 10)).toBe(true);
		expect(worthWalking(null, at(0), 31)).toBe(false);
	});
	test('not closer than ten metres, nor than its own error', () => {
		expect(worthWalking(at(0), at(8), 5)).toBe(false);
		expect(worthWalking(at(0), at(12), 5)).toBe(true);
		expect(worthWalking(at(0), at(12), 20)).toBe(false);
		expect(worthWalking(at(0), at(22), 20)).toBe(true);
	});
	test('a jump of the GPS adds nothing, but a long gap counts as a straight line', () => {
		const jump = addPoints(null, [at(0, 0), at(500, 5_000), at(30, 20_000)], FASTEST_WALK);
		expect(jump.kept).toHaveLength(2);
		expect(Math.round(jump.distance)).toBe(30);
		const gap = addPoints(null, [at(0, 0), at(500, 600_000)], FASTEST_WALK);
		expect(Math.round(gap.distance)).toBe(500);
	});
});

describe('a finished walk sent by the browser', () => {
	const good = { startedAt: 1000, endedAt: 2000, points: [at(0, 1500)], diagnosis: noDiagnosis() };
	test('kept with its good positions and gaps', () => {
		const gap = { at: 1, seconds: 40, metres: 3, hidden: true, music: false, reopened: false };
		const walk = parseWalk({
			...good,
			points: [at(0, 1500), { t: 'x' }],
			diagnosis: { ...noDiagnosis(), gaps: [gap, { at: 'y' }] }
		});
		expect(walk?.points).toHaveLength(1);
		expect(walk?.diagnosis.gaps).toEqual([gap]);
		expect(walk?.startedAt).toEqual(new Date(1000));
	});
	test('refused if it is not one', () => {
		expect(parseWalk(null)).toBeNull();
		expect(parseWalk({ ...good, endedAt: 500 })).toBeNull();
		expect(parseWalk({ ...good, points: 'no' })).toBeNull();
		expect(parseWalk({ ...good, diagnosis: undefined })).toBeNull();
	});
});

describe('how it reads', () => {
	test('distance', () => {
		expect(walkDistanceText(850.4)).toBe('850 m');
		expect(walkDistanceText(3420)).toBe('3,42 km');
	});
	test('clock', () => {
		expect(clockText(65)).toBe('1:05');
		expect(clockText(3725)).toBe('1:02:05');
	});
	test('pace, once it means something', () => {
		expect(paceText(30, 60)).toBeNull();
		expect(paceText(1000, 690)).toBe('11:30 min/km');
	});
});

describe('totals', () => {
	test('a week starts on Monday, also from a Sunday and across months', () => {
		expect(mondayOf('2026-11-05')).toBe('2026-11-02');
		expect(mondayOf('2026-11-02')).toBe('2026-11-02');
		expect(mondayOf('2026-11-01')).toBe('2026-10-26');
	});
	test('this week and this month', () => {
		const w = (day: string) => ({ day, distance: 1000, seconds: 600 });
		const totals = walkTotals(
			[w('2026-11-05'), w('2026-11-02'), w('2026-11-01'), w('2026-10-31')],
			'2026-11-05'
		);
		expect(totals.week).toEqual({ walks: 2, distance: 2000, seconds: 1200 });
		expect(totals.month).toEqual({ walks: 3, distance: 3000, seconds: 1800 });
	});
});
