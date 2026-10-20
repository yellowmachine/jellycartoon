import { describe, expect, test } from 'bun:test';
import { durationText, estimate, Pace, plannedLeft } from './road-eta.ts';
import type { Guidance } from './road-guide.ts';
import type { Route } from './road.ts';

// 60 km of motorway in 30 minutes, then 4 km of town in 12.
const route: Route = {
	line: [],
	distance: 64_000,
	duration: 2520,
	steps: [
		{ instruction: 'Autovía', distance: 60_000, duration: 1800, at: [0, 0], index: 0, type: 11 },
		{ instruction: 'Ciudad', distance: 4000, duration: 720, at: [0, 0], index: 1, type: 1 },
		{ instruction: 'Llegada', distance: 0, duration: 0, at: [0, 0], index: 2, type: 10 }
	]
};
const at = (nextIndex: number, toNext: number, remaining: number): Guidance => ({
	next: route.steps[nextIndex] ?? null,
	nextIndex,
	toNext,
	remaining,
	off: 0,
	arrived: false
});

describe('plannedLeft: stretch by stretch', () => {
	test('half the motorway left: its half and all the town', () => {
		expect(plannedLeft(route, at(1, 30_000, 34_000))).toBe(900 + 720);
	});

	test('the town only: its own pace, not the average', () => {
		// 2 km of town: 6 minutes. By the average (64 km in 42 min) it would be under 2.
		expect(plannedLeft(route, at(2, 2000, 2000))).toBe(360);
	});

	test('arrived: nothing', () => {
		expect(plannedLeft(route, { ...at(2, 0, 0), arrived: true })).toBe(0);
	});
});

describe('Pace: as one drives', () => {
	test('the first km: as reckoned', () => {
		const pace = new Pace();
		expect(pace.factor(2000, 60)).toBe(1);
	});

	test('slower than reckoned: the rest, as slow (not more than 40%)', () => {
		const pace = new Pace();
		// 20 minutes driving, 1 s at a time, for what it reckoned at 15.
		for (let t = 0; t <= 1200; t++) pace.tick(t * 1000, 25);
		expect(pace.factor(30_000, 900)).toBeCloseTo(1.333, 2);
		expect(pace.factor(30_000, 300)).toBe(1.4);
	});

	test('parked does not count as slow', () => {
		const pace = new Pace();
		for (let t = 0; t <= 600; t++) pace.tick(t * 1000, 25);
		// Ten minutes parked, for a coffee.
		for (let t = 601; t <= 1200; t++) pace.tick(t * 1000, 0);
		expect(pace.factor(10_000, 600)).toBe(1);
	});

	test('made again on the way: what was learned stays; another place, not', () => {
		const pace = new Pace();
		for (let t = 0; t <= 1200; t++) pace.tick(t * 1000, 25);
		pace.factor(30_000, 900);
		pace.restart(true);
		expect(pace.factor(1000, 30)).toBeCloseTo(1.333, 2);
		pace.restart(false);
		expect(pace.factor(1000, 30)).toBe(1);
	});
});

test("estimate: the arrival, at one's pace", () => {
	const now = Date.UTC(2026, 9, 20, 16, 0);
	const { seconds, arrival } = estimate(route, at(1, 30_000, 34_000), new Pace(), now);
	expect(seconds).toBe(1620);
	expect(arrival.getTime()).toBe(now + 1_620_000);
});

test('durationText', () => {
	expect(durationText(20)).toBe('1 min');
	expect(durationText(720)).toBe('12 min');
	expect(durationText(5100)).toBe('1 h 25 min');
});
