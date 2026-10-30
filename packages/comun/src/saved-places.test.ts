import { expect, test } from 'bun:test';
import type { LngLat } from './road.ts';
import { asksForRoute, findByName, insertStop, stopsAhead } from './saved-places.ts';

const kept = [{ name: 'Casa' }, { name: 'Trabajo' }, { name: 'Centro comercial Luz del Tajo' }];

test('by its name, accents, case and what is said before it aside', () => {
	expect(findByName(kept, 'casa')?.name).toBe('Casa');
	expect(findByName(kept, 'a casa')?.name).toBe('Casa');
	expect(findByName(kept, 'al trabajo')?.name).toBe('Trabajo');
	expect(findByName(kept, 'la ruta del trabajo')?.name).toBe('Trabajo');
	expect(findByName(kept, 'mi casa')?.name).toBe('Casa');
	expect(findByName(kept, '¡Casa!')?.name).toBe('Casa');
	expect(findByName(kept, 'luz del tajo')?.name).toBe('Centro comercial Luz del Tajo');
});

test('none, or more than one with those words: null, for the search to look', () => {
	expect(findByName(kept, 'Calle Mayor 5, Madrid')).toBeNull();
	expect(findByName(kept, '')).toBeNull();
	expect(findByName([{ name: 'Casa' }, { name: 'Casa de los abuelos' }], 'casa')?.name).toBe(
		'Casa'
	);
	expect(findByName([{ name: 'Casa de Ana' }, { name: 'Casa de los abuelos' }], 'casa')).toBeNull();
});

test('«la ruta de…» asks for a route', () => {
	expect(asksForRoute('ruta del trabajo')).toBe(true);
	expect(asksForRoute('La ruta de casa')).toBe(true);
	expect(asksForRoute('casa')).toBe(false);
	expect(asksForRoute('Rutas del vino, Valdepeñas')).toBe(false);
});

// A straight way east, a little more than 4 km: start, two stops on the way, end.
const line: LngLat[] = [0, 1, 2, 3, 4].map((i) => [-3.7 + i * 0.012, 40.4]);
const stop = (name: string, i: number) => ({ name, at: line[i]! });
const route = {
	line,
	stops: [stop('Casa', 0), stop('Gasolinera', 1), stop('Cole', 3), stop('Trabajo', 4)]
};

test('from the start: every stop after it', () => {
	expect(stopsAhead(route, line[0]!).map((s) => s.name)).toEqual(['Gasolinera', 'Cole', 'Trabajo']);
});

test('from far from its start: never back to it', () => {
	expect(stopsAhead(route, [-3.75, 40.45]).map((s) => s.name)).toEqual([
		'Gasolinera',
		'Cole',
		'Trabajo'
	]);
});

test('halfway: the stops passed, or being passed, are left out', () => {
	expect(stopsAhead(route, [-3.7 + 0.018, 40.4]).map((s) => s.name)).toEqual(['Cole', 'Trabajo']);
	expect(stopsAhead(route, [-3.7 + 0.0355, 40.4]).map((s) => s.name)).toEqual(['Trabajo']);
});

test('only a start and an end: the end', () => {
	expect(stopsAhead({ line, stops: [stop('Casa', 0), stop('Trabajo', 4)] }, line[2]!)).toEqual([
		stop('Trabajo', 4)
	]);
});

// Vélez-Rubio to Alicante, by Lorca, Totana and Murcia.
const velez: LngLat = [-2.077, 37.648];
const lorca: LngLat = [-1.701, 37.677];
const totana: LngLat = [-1.501, 37.769];
const murcia: LngLat = [-1.13, 37.992];
const alicante: LngLat = [-0.481, 38.345];

test('a new stop, where it lengthens the way least', () => {
	const said = (name: string, at: LngLat) => ({ name, at });
	expect(insertStop([], said('Totana', totana), velez, alicante).map((s) => s.name)).toEqual([
		'Totana'
	]);
	const ahead = [said('Lorca', lorca), said('Murcia', murcia)];
	expect(insertStop(ahead, said('Totana', totana), velez, alicante).map((s) => s.name)).toEqual([
		'Lorca',
		'Totana',
		'Murcia'
	]);
	expect(
		insertStop([said('Murcia', murcia)], said('Lorca', lorca), velez, alicante).map((s) => s.name)
	).toEqual(['Lorca', 'Murcia']);
	expect(
		insertStop([said('Lorca', lorca)], said('Murcia', murcia), velez, alicante).map((s) => s.name)
	).toEqual(['Lorca', 'Murcia']);
});
