import { expect, test } from 'bun:test';
import { hazardsOf, warningsOf, wayPoints, type PointWeather } from './route-weather.ts';
import type { LngLat } from './road.ts';

const line: LngLat[] = [
	[-4.0273, 39.8628],
	[-4.7, 41.65],
	[-5.8494, 43.3614]
];
const start = new Date(2026, 9, 31, 8, 30).getTime();

test('a point every half hour of driving or 15 km, the start and the end', () => {
	// 420 km in 4 h 50 min: by distance, 28 steps; by time, 10.
	const points = wayPoints(line, start, 4 * 3600 + 50 * 60);
	expect(points).toHaveLength(29);
	for (let i = 1; i < points.length; i++) {
		expect(points[i]!.km - points[i - 1]!.km).toBeLessThanOrEqual(16);
		expect(points[i]!.when - points[i - 1]!.when).toBeLessThanOrEqual(30 * 60 * 1000);
	}
	// A short slow one, by time: 20 km in 2 hours, every half hour.
	expect(wayPoints([line[0]!, [-4.0273, 40.04]], start, 2 * 3600)).toHaveLength(5);
	expect(points[0]!.at).toEqual(line[0]!);
	expect(points[0]!.km).toBe(0);
	expect(points.at(-1)!.at[0]).toBeCloseTo(line.at(-1)![0], 6);
	expect(points.at(-1)!.when - start).toBe((4 * 3600 + 50 * 60) * 1000);
	expect(wayPoints([line[0]!], start, 3600)).toEqual([]);
});

const fine: PointWeather = {
	temperature: 10,
	precipitation: 0,
	snowfall: 0,
	rain: 0,
	code: 1,
	gusts: 20,
	visibility: 30_000,
	elevation: 600
};

test('only what matters when driving', () => {
	expect(hazardsOf(fine)).toEqual([]);
	expect(hazardsOf({ ...fine, code: 61, precipitation: 1, rain: 80 })).toEqual([]);
	expect(
		hazardsOf({ ...fine, code: 73, snowfall: 1.2, temperature: -1, precipitation: 1 })
	).toEqual(['nieve']);
	expect(hazardsOf({ ...fine, temperature: 0, precipitation: 0.5, code: 61 })).toEqual(['hielo']);
	expect(hazardsOf({ ...fine, code: 45, visibility: 300 })).toEqual(['niebla']);
	expect(hazardsOf({ ...fine, code: 95, precipitation: 8 })).toEqual(['tormenta']);
	expect(hazardsOf({ ...fine, precipitation: 6, code: 65 })).toEqual(['lluvia']);
	expect(hazardsOf({ ...fine, gusts: 85 })).toEqual(['viento']);
});

test('a hazard in a row of points, once, with its worst', () => {
	const points = wayPoints(line, start, 3 * 3600);
	const weather = points.map((_, i) =>
		i >= 2 && i <= 4 ? { ...fine, code: 73, snowfall: i * 0.5, elevation: 1000 + i * 100 } : fine
	);
	const [snow, ...rest] = warningsOf(points, weather);
	expect(rest).toEqual([]);
	expect(snow).toMatchObject({ hazard: 'nieve', from: points[2]!.when, to: points[4]!.when });
	expect(snow!.snowfall).toBe(2);
	expect(snow!.elevation).toBe(1400);
	expect(
		warningsOf(
			points,
			points.map(() => null)
		)
	).toEqual([]);
});
