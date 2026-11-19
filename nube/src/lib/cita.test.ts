import { expect, test } from 'bun:test';
import { citaKey, citaWhen, parseCita } from './cita.ts';

test('a plan (#555): what and a day at least; times that make sense; from the AI or as saved', () => {
	expect(
		parseCita({ title: ' Comida ', day: '2026-11-22', time: '14:00', end_time: '17:00' })
	).toEqual({
		title: 'Comida',
		day: '2026-11-22',
		time: '14:00',
		endTime: '17:00',
		notes: null
	});
	expect(
		parseCita({ title: 'Cine', day: '2026-11-22', time: '18:00', endTime: '17:00' })?.endTime
	).toBeNull();
	expect(parseCita({ title: 'Playa', day: '2026-11-22', end_time: '17:00' })).toMatchObject({
		time: null,
		endTime: null
	});
	expect(parseCita({ title: 'Cine', day: '22/11/2026' })).toBeNull();
	expect(parseCita({ title: '', day: '2026-11-22' })).toBeNull();
	expect(parseCita({ title: 'x', day: '2026-11-22', time: '25:00' })?.time).toBeNull();
});

test('how it is said, and the same plan whatever the case', () => {
	expect(
		citaWhen({ title: 'x', day: '2026-11-21', time: '14:00', endTime: null, notes: null })
	).toBe('sábado, 21 de noviembre, 14:00');
	expect(citaKey({ title: 'Comida ', day: '2026-11-22', time: '14:00' })).toBe(
		citaKey({ title: 'comida', day: '2026-11-22', time: '14:00' })
	);
});
