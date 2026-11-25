import { describe, expect, test } from 'bun:test';
import { dayStretches, stretchAt, whereAt } from './owntracks-day.ts';
import { walkingOutings, type TrackPoint } from './owntracks-walking.ts';

/** At a minute of the day, so many metres east of home. */
const at = (minute: number, metres: number, speed: number | null = null): TrackPoint => ({
	at: new Date(Date.UTC(2026, 10, 25, 8, minute)),
	lon: -1.13 + metres / 87_900,
	lat: 37.98,
	accuracy: 10,
	speed
});
const of = (points: TrackPoint[], walks: { startedAt: Date; endedAt: Date }[] = []) =>
	dayStretches(points, walkingOutings(points, walks), walks);
const kinds = (points: TrackPoint[]) => of(points).map((s) => s.kind);

describe('a day in stretches', () => {
	test('walked, then by car with a light on the way, then still', () => {
		const points = [
			at(0, 0),
			at(5, 400),
			at(10, 800),
			at(20, 800),
			at(23, 3800),
			at(25, 3800),
			at(28, 7800),
			at(60, 7800)
		];
		const found = of(points);
		expect(found.map((s) => s.kind)).toEqual(['pie', 'vehiculo']);
		expect(found[1]!.startedAt).toEqual(at(20, 0).at);
		expect(found[1]!.endedAt).toEqual(at(28, 0).at);
		expect(Math.round(found[1]!.distance / 100)).toBe(70);
	});
	test('a long stop parts two trips', () => {
		expect(kinds([at(0, 0), at(3, 3000), at(40, 3000), at(43, 0)])).toEqual([
			'vehiculo',
			'vehiculo'
		]);
	});
	test('between walking and a car, or over a long gap: unknown', () => {
		expect(kinds([at(0, 0), at(5, 900), at(10, 1800)])).toEqual(['duda']);
		expect(kinds([at(0, 0), at(50, 900)])).toEqual(['duda']);
	});
	test('a fast average over a long gap is a vehicle', () => {
		expect(kinds([at(0, 0), at(40, 30_000)])).toEqual(['vehiculo']);
	});
	test('one wrong position is not a car; moving about is nothing', () => {
		expect(kinds([at(0, 0), at(1, 600), at(30, 600)])).toEqual(['duda']);
		expect(kinds([at(0, 0), at(5, 40), at(10, 0), at(15, 60)])).toEqual([]);
	});
	test('what an app walk covers is its own', () => {
		const walk = { startedAt: at(0, 0).at, endedAt: at(10, 0).at };
		expect(of([at(0, 0), at(5, 3000), at(10, 6000)], [walk])).toEqual([]);
	});
});

test('where one was: between two near in time, or in the same place; else not known', () => {
	const points = [at(0, 0), at(10, 1000), at(59, 1020)];
	expect(whereAt(points, at(5, 0).at)![0]).toBeCloseTo(at(0, 500).lon, 5);
	expect(whereAt(points, at(30, 0).at)![0]).toBeCloseTo(at(0, 1008).lon, 4);
	expect(whereAt([at(0, 0), at(50, 5000)], at(25, 0).at)).toBeNull();
	expect(whereAt([at(0, 0)], at(5, 0).at)).not.toBeNull();
	expect(whereAt([at(0, 0)], at(30, 0).at)).toBeNull();
	expect(whereAt([], at(5, 0).at)).toBeNull();
});

test('a moment’s stretch', () => {
	const [s] = of([at(0, 0), at(3, 3000), at(6, 6000)]);
	expect(stretchAt([s!], at(2, 0).at)).toBe(0);
	expect(stretchAt([s!], at(9, 0).at)).toBeNull();
});
