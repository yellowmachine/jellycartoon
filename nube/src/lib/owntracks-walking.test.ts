import { describe, expect, test } from 'bun:test';
import { walkingOutings, type TrackPoint } from './owntracks-walking.ts';

/** About 111 m per 0.001° of latitude. */
const start = Date.UTC(2026, 10, 22, 9);
const at = (minutes: number, metresNorth: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({
	at: new Date(start + minutes * 60_000),
	lon: -1.13,
	lat: 37.98 + metresNorth / 111_195,
	accuracy: 10,
	speed: null,
	...extra
});
/** Every minute for `minutes`, at `kmh`, from `from` minutes and metres. */
const go = (from: number, minutes: number, kmh: number, metres = 0) =>
	Array.from({ length: minutes + 1 }, (_, i) => at(from + i, metres + (kmh * 1000 * i) / 60));

describe('walkingOutings', () => {
	test('half an hour at 5 km/h: one outing of about 2.5 km', () => {
		const [o, ...rest] = walkingOutings(go(0, 30, 5));
		expect(rest).toEqual([]);
		expect(o!.distance).toBeCloseTo(2500, -1);
		expect(o!.startedAt).toEqual(new Date(start));
		expect(o!.endedAt).toEqual(new Date(start + 30 * 60_000));
		expect(o!.line).toHaveLength(31);
	});

	test('in a car, or standing still, it is not walking', () => {
		expect(walkingOutings(go(0, 20, 50))).toEqual([]);
		expect(walkingOutings(go(0, 60, 0))).toEqual([]);
		// Slow by its positions, but the phone says it goes at 30 km/h: a traffic jam.
		const jam = go(0, 20, 5).map((p) => ({ ...p, speed: 30 }));
		expect(walkingOutings(jam)).toEqual([]);
	});

	test('a short stop goes on in the same outing; a long one makes two', () => {
		const shortStop = [...go(0, 10, 5), ...go(12, 10, 5, 834)];
		expect(walkingOutings(shortStop)).toHaveLength(1);
		const longStop = [...go(0, 10, 5), ...go(20, 10, 5, 834)];
		expect(walkingOutings(longStop)).toHaveLength(2);
	});

	test('driving then walking: only the walk, from where it started', () => {
		const [o, ...rest] = walkingOutings([...go(0, 10, 40), ...go(11, 15, 5, 6667 + 1000)]);
		expect(rest).toEqual([]);
		expect(o!.startedAt).toEqual(new Date(start + 11 * 60_000));
	});

	test('sparse positions (Significant, every 15 min) still count; a longer gap does not', () => {
		const sparse = [at(0, 0), at(15, 1250), at(30, 2500)];
		expect(walkingOutings(sparse)[0]!.distance).toBeCloseTo(2500, -1);
		expect(walkingOutings([at(0, 0), at(40, 3000)])).toEqual([]);
	});

	test('inaccurate positions are not used, and very short outings not counted', () => {
		expect(walkingOutings(go(0, 30, 5).map((p) => ({ ...p, accuracy: 200 })))).toEqual([]);
		expect(walkingOutings(go(0, 2, 5))).toEqual([]);
	});

	test("what overlaps an app walk is that walk's", () => {
		const points = go(0, 60, 5);
		const appWalk = {
			startedAt: new Date(start + 20 * 60_000),
			endedAt: new Date(start + 40 * 60_000)
		};
		const outings = walkingOutings(points, [appWalk]);
		expect(outings).toHaveLength(2);
		expect(outings[0]!.endedAt).toEqual(appWalk.startedAt);
		expect(outings[1]!.startedAt).toEqual(appWalk.endedAt);
		const total = outings.reduce((sum, o) => sum + o.distance, 0);
		expect(total).toBeCloseTo((5000 / 60) * 40, -1);
	});

	test('positions out of order or repeated', () => {
		const points = go(0, 30, 5);
		const shuffled = [...points.slice(15), ...points.slice(0, 15), points[3]!];
		expect(walkingOutings(shuffled)[0]!.distance).toBeCloseTo(2500, -1);
	});
});
