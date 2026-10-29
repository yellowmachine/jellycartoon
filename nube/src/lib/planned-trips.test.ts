import { expect, test } from 'bun:test';
import { arrivalOf, tripOver, warningText, whenText, type PlannedTrip } from './planned-trips.ts';

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

test('a warning on the way, said', () => {
	const w = {
		hazard: 'nieve' as const,
		from: new Date(2026, 9, 31, 12, 0).getTime(),
		to: new Date(2026, 9, 31, 12, 30).getTime(),
		at: [-5.77, 42.98] as [number, number],
		km: 330,
		elevation: 1350,
		rain: 80,
		snowfall: 1.5,
		gusts: 30,
		visibility: 5000,
		temperature: -1,
		town: 'Pajares'
	};
	expect(warningText(w)).toBe('❄️ Nieve de 12:00 a 12:30, cerca de Pajares (1350 m), 1,5 cm/h');
	expect(
		warningText({ ...w, town: null, to: w.from, hazard: 'viento', gusts: 80, elevation: 300 })
	).toBe('💨 Viento hacia las 12:00, en el km 330, rachas de 80 km/h');
});
