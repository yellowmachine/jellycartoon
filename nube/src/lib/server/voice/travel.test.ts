import { describe, expect, test } from 'bun:test';
import type { LngLat, Place } from 'comun/road.ts';
import { inTown, splitPlace } from './travel.ts';

describe('splitPlace', () => {
	test('what and the town after it', () => {
		expect(splitPlace('El Extremeño, Sangonera la Seca, Murcia')).toEqual({
			what: 'El Extremeño',
			town: 'Sangonera la Seca, Murcia'
		});
	});
	test('a town alone', () => {
		expect(splitPlace('Sangonera la Seca')).toEqual({ what: 'Sangonera la Seca', town: null });
	});
});

describe('inTown', () => {
	const sangonera: LngLat = [-1.2075, 37.9731];
	const results: Place[] = [
		// Its name in the label, but in Puerto Lumbreras, ~60 km away.
		{ label: 'Calle Sangonera la Seca, Puerto Lumbreras, MU, España', at: [-1.8106, 37.5636] },
		{ label: 'El Extremeño, Avenida de Lorca, Murcia, MU, España', at: [-1.2041, 37.9702] }
	];
	test('by where it is, not by its name', () => {
		expect(inTown(results, sangonera)?.label).toStartWith('El Extremeño');
	});
	test('none there: none', () => {
		expect(inTown(results.slice(0, 1), sangonera)).toBeNull();
	});
});
