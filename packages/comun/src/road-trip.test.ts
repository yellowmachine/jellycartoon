import { expect, test } from 'bun:test';
import type { LngLat } from './road.ts';
import { BREAK_MS, newTrip, parseTrip, restDue, tick, type TripState } from './road-trip.ts';

/** Driving east at ~25 m/s (90 km/h), a position a second, for `seconds`. */
function drive(trip: TripState, seconds: number, start = 0): TripState {
	let t = trip;
	for (let s = 0; s <= seconds; s++) {
		const at: LngLat = [-1.5 + (s * 25) / 85_000, 38];
		t = tick(t, at, 25, start + s * 1000);
	}
	return t;
}

test('km and time moving, from the positions', () => {
	const t = drive(newTrip(), 600);
	expect(t.metres / 1000).toBeCloseTo(15, 0);
	expect(t.moving).toBeCloseTo(600, 0);
	expect(t.sinceBreak).toBeCloseTo(600, 0);
});

test('a GPS jump is not driven', () => {
	let t = tick(newTrip(), [-1.5, 38], 25, 0);
	t = tick(t, [-1.4, 38], 25, 1000);
	expect(t.metres).toBe(0);
	expect(t.moving).toBe(1);
});

test('stopped 15 min is a rest; a short stop is not', () => {
	let t = drive(newTrip(), 60);
	const at: LngLat = t.last!.at;
	const end = t.last!.time;
	t = tick(t, at, 0, end + 60_000);
	t = tick(t, at, 0, end + 5 * 60_000);
	expect(t.sinceBreak).toBeGreaterThan(0);
	t = tick(t, at, 0, end + BREAK_MS + 1000);
	expect(t.sinceBreak).toBe(0);
	expect(t.metres).toBeGreaterThan(0);
});

test('no positions for 15 min is a rest; for hours, a new trip', () => {
	const t = drive(newTrip(), 60);
	const later = tick(t, t.last!.at, 25, t.last!.time + BREAK_MS);
	expect(later.sinceBreak).toBe(0);
	expect(later.metres).toBe(t.metres);
	const next = tick(t, t.last!.at, 25, t.last!.time + 4 * 3_600_000);
	expect(next.metres).toBe(0);
});

test('the rest, due after 2 h driving, once', () => {
	const t = { ...newTrip(), sinceBreak: 2 * 3600 };
	expect(restDue(t)).toBe(true);
	expect(restDue({ ...t, restSaid: true })).toBe(false);
	expect(restDue({ ...t, sinceBreak: 3600 })).toBe(false);
});

test('parseTrip: what was kept, or a new one', () => {
	const t = drive(newTrip(), 10);
	expect(parseTrip(JSON.parse(JSON.stringify(t)))).toEqual(t);
	expect(parseTrip(null)).toEqual(newTrip());
	expect(parseTrip({ metres: 'x' })).toEqual(newTrip());
});
