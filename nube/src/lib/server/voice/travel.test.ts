import { describe, expect, test } from 'bun:test';
import type { Place } from 'comun/road.ts';
import { inTown, splitPlace } from './travel.ts';

const place = (label: string): Place => ({ label, at: [0, 0] });

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
	const results = [
		place('Calle Sangonera la Verde, Lumbreras, MU, España'),
		place('El Extremeño, Avenida de Lorca, Sangonera La Seca, MU, España')
	];
	test('the first one in the town said, without minding accents or capitals', () => {
		expect(inTown(results, 'Sangonera la Seca, Murcia')?.label).toStartWith('El Extremeño');
	});
	test('none there: none', () => {
		expect(inTown(results.slice(0, 1), 'Sangonera la Seca')).toBeNull();
	});
	test('no town said: the first', () => {
		expect(inTown(results, null)?.label).toStartWith('Calle');
	});
});
