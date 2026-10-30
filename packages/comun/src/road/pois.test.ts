import { expect, test } from 'bun:test';
import { isPoiKind, poisFromOrs } from './pois.ts';

const feature = (name: string | null, distance: number, hours?: string) => ({
	geometry: { coordinates: [-1.5, 37.77] },
	properties: {
		distance,
		osm_tags: { ...(name ? { name } : {}), ...(hours ? { opening_hours: hours } : {}) }
	}
});

test('nearest first, with their hours; without a name, their kind and a number', () => {
	const found = poisFromOrs(
		{
			features: [
				feature('Horno San José', 700, 'Mo-Sa 08:00-14:00'),
				feature(null, 300),
				feature('Panadería Lola', 150),
				feature(null, 900)
			]
		},
		'panadería'
	);
	expect(found.map((p) => p.name)).toEqual([
		'Panadería Lola',
		'Panadería 1',
		'Horno San José',
		'Panadería 2'
	]);
	expect(found[2]!.hours).toBe('Mo-Sa 08:00-14:00');
	expect(found[0]!.hours).toBeNull();
});

test('the same name twice, the nearer; at most `count`; nothing, an empty list', () => {
	const found = poisFromOrs(
		{ features: [feature('Mercadona', 900), feature('mercadona', 200), feature('Dia', 400)] },
		'supermercado',
		1
	);
	expect(found).toEqual([{ name: 'mercadona', at: [-1.5, 37.77], distance: 200, hours: null }]);
	expect(poisFromOrs(null, 'bar')).toEqual([]);
	expect(poisFromOrs({ features: [{ geometry: {} }] }, 'bar')).toEqual([]);
});

test('only the kinds there are', () => {
	expect(isPoiKind('panadería')).toBe(true);
	expect(isPoiKind('toString')).toBe(false);
	expect(isPoiKind('zapatería')).toBe(false);
});
