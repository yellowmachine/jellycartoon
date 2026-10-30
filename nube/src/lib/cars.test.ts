import { describe, expect, test } from 'bun:test';
import { agoText, isMoving, latestPlace, walkTo, type CarPlace } from './cars.ts';

const place = (when: string, trip: boolean): CarPlace => ({
	at: [-3.7, 40.4],
	when: new Date(when),
	by: 'Ana',
	note: trip ? null : 'Planta -2',
	trip
});

describe('latestPlace', () => {
	test('the later one wins, either way', () => {
		const marked = place('2026-10-30T10:00:00', false);
		const trip = place('2026-10-30T09:50:00', true);
		expect(latestPlace(marked, trip)).toBe(marked);
		const later = place('2026-10-30T11:00:00', true);
		expect(latestPlace(marked, later)).toBe(later);
	});

	test('one or none', () => {
		const trip = place('2026-10-30T09:50:00', true);
		expect(latestPlace(null, trip)).toBe(trip);
		expect(latestPlace(null, null)).toBeNull();
	});
});

describe('agoText', () => {
	const now = new Date('2026-10-30T18:00:00');
	test('minutes, hours, today, yesterday, a day', () => {
		expect(agoText(new Date('2026-10-30T17:59:40'), now)).toBe('ahora mismo');
		expect(agoText(new Date('2026-10-30T17:35:00'), now)).toBe('hace 25 min');
		expect(agoText(new Date('2026-10-30T15:00:00'), now)).toBe('hace 3 h');
		expect(agoText(new Date('2026-10-30T09:15:00'), now)).toMatch(/^hoy a las 9:15/);
		expect(agoText(new Date('2026-10-29T18:40:00'), now)).toMatch(/^ayer a las 18:40/);
		expect(agoText(new Date('2026-10-24T09:15:00'), now)).toMatch(/^el .+ a las 9:15/);
	});
});

test('isMoving: only a trip, only recent', () => {
	const now = new Date('2026-10-30T18:00:00');
	expect(isMoving(place('2026-10-30T17:59:30', true), now)).toBe(true);
	expect(isMoving(place('2026-10-30T17:50:00', true), now)).toBe(false);
	expect(isMoving(place('2026-10-30T17:59:30', false), now)).toBe(false);
});

test('walkTo: latitude first, on foot', () => {
	expect(walkTo([-3.7, 40.4])).toBe(
		'https://www.google.com/maps/dir/?api=1&destination=40.4,-3.7&travelmode=walking'
	);
});
