import { expect, mock, test } from 'bun:test';
import type { Kitchen } from '../fridge.ts';

/**
 * Preguntar's «read_energy_forecast» (#513 phase 4): the page's forecast in words, the three parts
 * faked (each tested on its own: forecast.test.ts, fuel.test.ts, solar.test.ts).
 */
const fit = { base: 3, perDegree: 0.5, spread: 1, n: 20 };
let forecast: unknown = null;
let fuels: unknown[] = [];
let solar: unknown = null;
mock.module('./forecast.ts', () => ({ energyForecast: async () => forecast }));
mock.module('./fuel.ts', () => ({ fuelStates: async () => fuels }));
mock.module('./solar.ts', () => ({ solarState: async () => solar }));
const { describeEnergyForecast } = await import('./forecast-read.ts');
const k = { familyId: 'A', userId: null, run: async () => null } as unknown as Kitchen;

const day = (d: string, mean: number) => ({
	day: d,
	min: mean - 3,
	max: mean + 3,
	mean,
	degrees: 18 - mean
});

test('without a place, or without the weather, it says so', async () => {
	forecast = null;
	expect(await describeEnergyForecast(k)).toContain('Dónde vivís');
	forecast = 'No se pudo saber la previsión del tiempo.';
	expect(await describeEnergyForecast(k)).toBe('No se pudo saber la previsión del tiempo.');
});

test('the cold, the light learned and still learning, butane and the panels', async () => {
	forecast = {
		place: 'Pueblo',
		days: [day('2026-11-15', 8), day('2026-11-16', 6)],
		degrees: 22,
		degreesBefore: 15,
		plugs: { have: 5, need: 14 },
		bills: {
			learned: {
				fit,
				expected: { kwh: 30, low: 25, high: 35 },
				euros: { kwh: 6, low: 5, high: 7 }
			}
		}
	};
	fuels = [
		{
			kind: 'butano',
			full: 1,
			spots: [
				{
					name: '',
					unit: { id: 1, startedOn: '2026-11-10' },
					by: 'aprendido',
					left: 0.4,
					ends: '2026-11-18',
					sums: { units: 4, days: 15.2, perDay: 121.7, priced: 4 }
				}
			],
			unitCost: 1850,
			spent: { total: 7400, unpriced: 0 },
			uncounted: [],
			outlook: {
				allEnds: '2026-11-29',
				needed: { kwh: 1.6, low: 1, high: 2 },
				toBuy: 1
			}
		}
	];
	solar = {
		row: { groups: [{ kwp: 4, tilt: 30, azimuth: 0 }], batteryKwh: 5 },
		forecast: {
			use: { by: 'dicho', kwh: 9 },
			price: 0.2,
			days: [
				{
					day: '2026-11-15',
					made: 12,
					used: 9,
					fromGrid: 2,
					toGrid: 3,
					full: true,
					emptyAt: 4,
					spare: { from: 11, to: 14, kwh: 3 }
				},
				{
					day: '2026-11-16',
					made: 2,
					used: 9,
					fromGrid: 7,
					toGrid: 0,
					full: false,
					emptyAt: 19,
					spare: null
				}
			]
		}
	};
	const text = await describeEnergyForecast(k);
	expect(text).toContain('22 grados-día de calefacción (los 2 anteriores, 15)');
	expect(text).toContain('2026-11-16 media 6 °C, 12 grados-día');
	expect(text).toContain(
		'Lo enchufado (solo los enchufes de Energía): aún aprendiendo (días de enchufes: 5 de 14)'
	);
	// With panels the bills only say the grid.
	expect(text).toContain('De la red según las facturas');
	expect(text).toContain('unos 30 kWh, entre 25 y 35');
	expect(text).toContain('3 kWh al día sin frío y 0,5 más por grado-día');
	expect(text).toContain('Butano: 1 bombona llena en casa');
	expect(text).toContain('hasta el 2026-11-29');
	expect(text).toContain('hay que comprar 1');
	expect(text).toContain('darán unos 14 kWh; de la red, unos 9 kWh');
	expect(text).toContain('la batería se acaba a las 4 de madrugada, sobra sol de 11 a 14 (3 kWh)');
	expect(text).toContain('la batería se acaba a las 19.');
});

test('panels without what the house uses: it says what is missing', async () => {
	fuels = [];
	solar = {
		row: { groups: [{ kwp: 3, tilt: 30, azimuth: 0 }], batteryKwh: null },
		forecast: { use: { by: null, bills: null }, price: null, days: [] }
	};
	const text = await describeEnergyForecast(k);
	expect(text).toContain('Placas: 3 kWp, sin batería. Falta lo que gasta la casa al día');
});
