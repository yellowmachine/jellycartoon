import { describe, expect, test } from 'bun:test';
import type { CarView } from '#lib/cars.ts';
import { carWithStreet } from './car-street.ts';

const parked = (lon: number, trip = false, when = new Date(0)): CarView => ({
	id: 1,
	name: 'Kia',
	place: { at: [lon, 37], when, by: null, note: null, trip }
});

describe('the street a car is in', () => {
	test('asked once for each point', async () => {
		let asked = 0;
		const near = async () => (asked++, 'Calle Reloj');
		for (const _ of [1, 2]) {
			const car = await carWithStreet(parked(1), near);
			expect(car?.place?.street).toBe('Calle Reloj');
		}
		expect(asked).toBe(1);
		await carWithStreet(parked(2), near);
		expect(asked).toBe(2);
	});

	test('in the country, none, and it is not asked again', async () => {
		let asked = 0;
		const near = async () => (asked++, null);
		await carWithStreet(parked(3), near);
		const car = await carWithStreet(parked(3), near);
		expect(car?.place?.street).toBeNull();
		expect(asked).toBe(1);
	});

	test('a failure shows no street and is asked again', async () => {
		const car = await carWithStreet(parked(4), async () => {
			throw new Error('sin cuota');
		});
		expect(car?.place?.street).toBeNull();
		expect((await carWithStreet(parked(4), async () => 'Calle Sol'))?.place?.street).toBe(
			'Calle Sol'
		);
	});

	test('late, the card does not wait, and the next look has it', async () => {
		const near = () => new Promise<string>((r) => setTimeout(() => r('Calle Lenta'), 30));
		expect((await carWithStreet(parked(5), near, 1))?.place?.street).toBeNull();
		await Bun.sleep(40);
		expect((await carWithStreet(parked(5), near, 1))?.place?.street).toBe('Calle Lenta');
	});

	test('on a trip still going, not asked', async () => {
		let asked = 0;
		const car = await carWithStreet(parked(6, true, new Date()), async () => (asked++, 'Calle'));
		expect(asked).toBe(0);
		expect(car?.place?.street).toBeUndefined();
	});

	test('no car, or no place: as it is', async () => {
		const never = async () => 'Calle';
		expect(await carWithStreet(null, never)).toBeNull();
		const unknown: CarView = { id: 1, name: 'Kia', place: null };
		expect(await carWithStreet(unknown, never)).toEqual(unknown);
	});
});
