import { expect, test } from 'bun:test';
import { arrivalOf, tripOver, whenText, type PlannedTrip } from './planned-trips.ts';

const leg = (day: string, time: string, duration: number) => ({
	id: 1,
	day,
	time,
	from: 'Toledo',
	to: 'Oviedo',
	start: [-4.02, 39.86] as [number, number],
	end: [-5.85, 43.36] as [number, number],
	distance: 450_000,
	duration
});

test('when a leg arrives, also the next day', () => {
	expect(arrivalOf(leg('2026-11-01', '09:00', 4 * 3600 + 50 * 60))).toEqual({
		day: '2026-11-01',
		time: '13:50'
	});
	expect(arrivalOf(leg('2026-11-01', '22:30', 3 * 3600))).toEqual({
		day: '2026-11-02',
		time: '01:30'
	});
});

test('«hoy», «mañana», «en N días»', () => {
	expect(whenText('2026-10-29', '2026-10-29')).toBe('hoy');
	expect(whenText('2026-10-30', '2026-10-29')).toBe('mañana');
	expect(whenText('2026-11-01', '2026-10-29')).toBe('en 3 días');
});

test('a trip is over once all its legs have arrived; one without legs is not', () => {
	const trip = (legs: ReturnType<typeof leg>[]): PlannedTrip => ({
		id: 1,
		name: 'Asturias',
		private: false,
		mine: true,
		people: [],
		legs
	});
	expect(tripOver(trip([]), '2026-10-29')).toBe(false);
	expect(tripOver(trip([leg('2026-10-20', '09:00', 3600)]), '2026-10-29')).toBe(true);
	expect(
		tripOver(
			trip([leg('2026-10-20', '09:00', 3600), leg('2026-11-01', '09:00', 3600)]),
			'2026-10-29'
		)
	).toBe(false);
});
