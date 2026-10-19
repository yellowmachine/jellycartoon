import { expect, test } from 'bun:test';
import { placesFromOrs, routeFromOrs } from './ors-parse.ts';

test('placesFromOrs: the ones with a name and a point', () => {
	expect(
		placesFromOrs({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-4.0245, 39.8628] },
					properties: { label: 'Plaza de Zocodover, Toledo, CM, España' }
				},
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [] },
					properties: { label: 'Sin punto' }
				},
				{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
			]
		})
	).toEqual([{ label: 'Plaza de Zocodover, Toledo, CM, España', at: [-4.0245, 39.8628] }]);
	expect(placesFromOrs(null)).toEqual([]);
});

test('routeFromOrs: the line, the totals, and each step where it is done', () => {
	const route = routeFromOrs({
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[-4.03, 39.86],
						[-4.02, 39.861],
						[-4.01, 39.862]
					]
				},
				properties: {
					summary: { distance: 1830.4, duration: 245.1 },
					segments: [
						{
							steps: [
								{
									distance: 900.2,
									duration: 120,
									type: 11,
									instruction: 'Camina hacia el este en Calle Real',
									name: 'Calle Real',
									way_points: [0, 1]
								},
								{
									distance: 930.2,
									duration: 125.1,
									type: 1,
									instruction: 'Gira a la derecha por Paseo del Miradero',
									name: 'Paseo del Miradero',
									way_points: [1, 2]
								},
								{
									distance: 0,
									duration: 0,
									type: 10,
									instruction: 'Llegada a tu destino',
									way_points: [2, 2]
								}
							]
						}
					]
				}
			}
		]
	});
	expect(route?.distance).toBe(1830.4);
	expect(route?.duration).toBe(245.1);
	expect(route?.line).toHaveLength(3);
	expect(route?.steps.map((s) => [s.instruction, s.at, s.type, s.index])).toEqual([
		// Setting off, by car: «Sal», not «Camina».
		['Sal hacia el este en Calle Real', [-4.03, 39.86], 11, 0],
		['Gira a la derecha por Paseo del Miradero', [-4.02, 39.861], 1, 1],
		['Llegada a tu destino', [-4.01, 39.862], 10, 2]
	]);
});

test('routeFromOrs: no route, null', () => {
	expect(routeFromOrs({ type: 'FeatureCollection', features: [] })).toBeNull();
	expect(routeFromOrs(null)).toBeNull();
});
