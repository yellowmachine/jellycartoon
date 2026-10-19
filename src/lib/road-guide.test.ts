import { describe, expect, test } from 'bun:test';
import { alongLine, guide, locate, metresBetween } from './road-guide.ts';
import type { LngLat, Route } from './road.ts';

// About 100 m of longitude at latitude 40.
const STEP = 0.001172;
const line: LngLat[] = [0, 1, 2, 3, 4].map((i) => [-4 + i * STEP, 40]);
const route: Route = {
	line,
	distance: 400,
	duration: 60,
	steps: [
		{ instruction: 'Sal hacia el este', distance: 200, at: line[0]!, index: 0, type: 11 },
		{ instruction: 'Gira a la derecha', distance: 200, at: line[2]!, index: 2, type: 1 },
		{ instruction: 'Llegada', distance: 0, at: line[4]!, index: 4, type: 10 }
	]
};
const along = alongLine(line);

test('metresBetween: a degree of latitude is about 111 km', () => {
	expect(metresBetween([0, 0], [0, 1])).toBeCloseTo(111_195, -2);
});

test('alongLine: the metres from the start of each point', () => {
	expect(along).toHaveLength(5);
	expect(along[0]).toBe(0);
	expect(along[4]!).toBeCloseTo(400, -1);
});

describe('locate', () => {
	test('on the line: how far along, and nothing off', () => {
		const here = locate(line, along, [-4 + 1.5 * STEP, 40]);
		expect(here.along).toBeCloseTo(150, -1);
		expect(here.off).toBeLessThan(1);
	});

	test('beside it: how far off', () => {
		// About 50 m north of the line.
		const here = locate(line, along, [-4 + STEP, 40.00045]);
		expect(here.along).toBeCloseTo(100, -1);
		expect(here.off).toBeCloseTo(50, -1);
	});
});

describe('guide', () => {
	test('setting off: the turn ahead, and how far', () => {
		const g = guide(route, along, line[0]!);
		expect(g.next?.instruction).toBe('Gira a la derecha');
		expect(g.toNext).toBeCloseTo(200, -1);
		expect(g.arrived).toBe(false);
	});

	test('past the turn: the arrival next', () => {
		const g = guide(route, along, [-4 + 2.5 * STEP, 40]);
		expect(g.next?.instruction).toBe('Llegada');
		expect(g.toNext).toBeCloseTo(150, -1);
		expect(g.remaining).toBeCloseTo(150, -1);
	});

	test('just at the turn: still that one, not the next', () => {
		const g = guide(route, along, [-4 + 1.95 * STEP, 40]);
		expect(g.next?.instruction).toBe('Gira a la derecha');
	});

	test('near the end: arrived, nothing next', () => {
		const g = guide(route, along, [-4 + 3.9 * STEP, 40]);
		expect(g.arrived).toBe(true);
		expect(g.next).toBeNull();
	});

	test('off the route: said in metres', () => {
		expect(guide(route, along, [-4 + STEP, 40.0009]).off).toBeCloseTo(100, -1);
	});
});
