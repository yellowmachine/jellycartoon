import { expect, test } from 'bun:test';
import { addPoints, durationText, worthKeeping, type TripPoint } from './trips.ts';

// About 100 m of longitude at latitude 40, ten seconds apart: 36 km/h.
const STEP = 0.001172;
const point = (i: number, speed: number | null = 10): TripPoint => ({
	t: 1_800_000_000_000 + i * 10_000,
	at: [-4 + i * STEP, 40],
	speed
});

test('worthKeeping: once moved 25 m, and only with a good fix', () => {
	expect(worthKeeping(null, point(0), 5)).toBe(true);
	expect(worthKeeping(point(0), { ...point(0), at: [-4 + STEP / 10, 40] }, 5)).toBe(false);
	expect(worthKeeping(point(0), point(1), 5)).toBe(true);
	expect(worthKeeping(point(0), point(1), 120)).toBe(false);
});

test('addPoints: in order, the metres and the fastest', () => {
	const { kept, distance, maxSpeed } = addPoints(null, [point(2, 12), point(0), point(1, 15)]);
	expect(kept.map((p) => p[2])).toEqual([1_800_000_000, 1_800_000_010, 1_800_000_020]);
	expect(distance).toBeCloseTo(200, -1);
	expect(maxSpeed).toBe(15);
});

test('addPoints: after the trip so far, counting from its last point', () => {
	const last = addPoints(null, [point(0)]).kept[0]!;
	expect(addPoints(last, [point(1)]).distance).toBeCloseTo(100, -1);
});

test('addPoints: the GPS jumping is left out', () => {
	const jump: TripPoint = { t: point(1).t, at: [-3.9, 40.1], speed: null };
	const { kept, distance } = addPoints(null, [point(0), jump, point(2)]);
	expect(kept).toHaveLength(2);
	expect(distance).toBeCloseTo(200, -1);
});

test('durationText', () => {
	expect(durationText(12 * 60)).toBe('12 min');
	expect(durationText(85 * 60)).toBe('1 h 25 min');
});
