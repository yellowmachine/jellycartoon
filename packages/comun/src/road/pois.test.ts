import { expect, test } from 'bun:test';
import type { LngLat } from 'comun/road.ts';
import { isPoiKind, poisAlong, poisFromOrs, stretches } from './pois.ts';

const feature = (
	name: string | null,
	distance: number,
	hours?: string,
	at: LngLat = [-1.5, 37.77]
) => ({
	geometry: { coordinates: at },
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

// About 100 m of longitude at latitude 40, a straight way east of 10 km.
const STEP = 0.001172;
const way: LngLat[] = Array.from({ length: 101 }, (_, i) => [-4 + i * STEP, 40]);

test('the way ahead in stretches, each from where the last ended, up to so far', () => {
	const parts = stretches(way, 5000, 2000);
	expect(parts.map((p) => [p[0], p.at(-1)])).toEqual([
		[way[0], way[21]],
		[way[21], way[42]],
		[way[42], way[51]]
	]);
	expect(stretches(way, 50_000, 30_000)).toEqual([way]);
	expect(stretches(way.slice(0, 1), 5000)).toEqual([]);
});

test('along the way: the first we come to first, how far off; same names told apart', () => {
	const near = (i: number, north = 0): LngLat => [-4 + i * STEP, 40 + north];
	const found = poisAlong(
		[
			{
				features: [
					feature('Repsol', 0, undefined, near(80)),
					feature('Repsol', 0, undefined, near(30, 0.002)),
					feature(null, 0, undefined, near(50))
				]
			},
			// Where two stretches meet, the same one twice.
			{ features: [feature('Repsol', 0, undefined, near(80))] }
		],
		way,
		'gasolinera'
	);
	expect(found.map((p) => p.name)).toEqual(['Repsol', 'Gasolinera 1', 'Repsol 2']);
	expect(Math.round(found[0]!.distance / 100)).toBe(30);
	expect(Math.round(found[0]!.off! / 10)).toBe(22);
	expect(found[2]!.off).toBeLessThan(1);
});
