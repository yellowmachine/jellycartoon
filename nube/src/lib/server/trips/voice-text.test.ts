import { describe, expect, test } from 'bun:test';
import type { PlannedLeg, PlannedTrip } from '#lib/planned-trips.ts';
import { tripsText } from './voice-text.ts';

/** The trips as the voice is told them (#347): what is said of each leg, and which are left out. */
const leg = (over: Partial<PlannedLeg>): PlannedLeg => ({
	id: 1,
	day: '2026-11-01',
	time: '09:00',
	from: 'Casa',
	to: 'Murcia',
	start: [-3.7, 40.4],
	end: [-1.13, 37.98],
	distance: 400_000,
	duration: 4 * 3600 + 10 * 60,
	...over
});
const trip = (over: Partial<PlannedTrip>): PlannedTrip => ({
	id: 1,
	name: 'Murcia',
	private: false,
	mine: true,
	people: [],
	legs: [leg({})],
	...over
});
const people = [
	{ id: 1, name: 'Miguel' },
	{ id: 2, name: 'Lucía' }
];

describe('trips said by voice', () => {
	test('none to come', () => {
		expect(tripsText([], {}, people, '2026-10-31')).toContain('No hay viajes planeados');
	});

	test('a leg: when, from where to where, how long, and its weather', () => {
		const text = tripsText(
			[trip({ people: ['1', '2'] })],
			{
				1: {
					depart: { temperature: 12.4, sky: 'despejado', code: 0, rain: 0, wind: 5 },
					arrive: { temperature: 21, sky: 'nubes y claros', code: 2, rain: 40, wind: 10 },
					way: []
				}
			},
			people,
			'2026-10-31'
		);
		expect(text).toContain('«Murcia», van Miguel, Lucía');
		expect(text).toContain('domingo, 1 de noviembre (mañana) a las 09:00: Casa → Murcia');
		expect(text).toContain('4 h 10 min, 400 km, llega hacia las 13:10');
		expect(text).toContain('al salir 12 °C, despejado');
		expect(text).toContain('al llegar 21 °C, nubes y claros, 40 % de lluvia');
		expect(text).toContain('sin avisos en el camino');
	});

	test('everyone’s, without its weather yet, and the past ones left out', () => {
		const text = tripsText(
			[
				trip({ id: 2, name: 'Ya hecho', legs: [leg({ id: 2, day: '2026-10-20' })] }),
				trip({ legs: [leg({ day: '2026-11-20' })] })
			],
			{},
			people,
			'2026-10-31'
		);
		expect(text).not.toContain('Ya hecho');
		expect(text).toContain('«Murcia», de toda la familia');
		expect(text).toContain('(en 20 días)');
		expect(text).not.toContain('al salir');
	});
});
