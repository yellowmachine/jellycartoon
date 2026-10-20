import { expect, test } from 'bun:test';
import { placesFromOrs, routeFromOrs, spokenSpanish } from './ors-parse.ts';

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
									instruction: 'Gire a la derecha a Paseo del Miradero',
									name: 'Paseo del Miradero',
									way_points: [1, 2]
								},
								{
									distance: 0,
									duration: 0,
									type: 10,
									instruction: 'Llegar a su destino',
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
	// Each step's own time, for what is left stretch by stretch.
	expect(route?.steps.map((s) => s.duration)).toEqual([120, 125.1, 0]);
	expect(route?.line).toHaveLength(3);
	expect(route?.steps.map((s) => [s.instruction, s.at, s.type, s.index])).toEqual([
		// Setting off, by car: «Sal», not «Camina».
		['Sal hacia el este en Calle Real', [-4.03, 39.86], 11, 0],
		['Gira a la derecha por Paseo del Miradero', [-4.02, 39.861], 1, 1],
		['Llegas a tu destino', [-4.01, 39.862], 10, 2]
	]);
});

test('routeFromOrs: no route, null', () => {
	expect(routeFromOrs({ type: 'FeatureCollection', features: [] })).toBeNull();
	expect(routeFromOrs(null)).toBeNull();
});

test('spokenSpanish: «tú», streets after «por», exits in words', () => {
	const cases: [string, string][] = [
		[
			'Camina hacia el suroeste en Camino Palacio de Galiana',
			'Sal hacia el suroeste en Camino Palacio de Galiana'
		],
		[
			'Gire a la izquierda a Camino Palacio de Galiana',
			'Gira a la izquierda por Camino Palacio de Galiana'
		],
		['Gire ligeramente a la derecha', 'Gira ligeramente a la derecha'],
		['Siga todo recto a Puente de Azarquiel', 'Sigue todo recto por Puente de Azarquiel'],
		[
			'Entre en la rotonda y tome la 2a salida a Ronda del Granadal',
			'Entra en la rotonda y toma la segunda salida hacia Ronda del Granadal'
		],
		['Entre en la rotonda y tome la 1a salida', 'Entra en la rotonda y toma la primera salida'],
		['Entre en la rotonda y salga a Calle Mayor', 'Entra en la rotonda y sal hacia Calle Mayor'],
		['Entrar en la rotonda', 'Entra en la rotonda'],
		['Haga una vuelta en U', 'Da la vuelta'],
		['Llegar a su destino, a la derecha', 'Llegas a tu destino, a la derecha'],
		['Llegar a Plaza de Zocodover, es recto', 'Llegas a Plaza de Zocodover, de frente']
	];
	for (const [ors, ours] of cases) expect(spokenSpanish(ors)).toBe(ours);
});
