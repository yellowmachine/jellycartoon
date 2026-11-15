import { afterEach, expect, mock, test } from 'bun:test';
import type { Place } from 'comun/weather.ts';
import type { Kitchen } from './fridge.ts';

/** Preguntar's read_weather: Open-Meteo faked, as the place «Dónde vivís» says or one named. */
let home: Place | null = null;
const searched: string[] = [];
mock.module('#lib/server/family-settings.ts', () => ({ familyPlace: async () => home }));
mock.module('#lib/server/places.ts', () => ({
	findPlacesFor: async (_k: Kitchen, name: string) => (
		searched.push(name),
		name === 'Alicante'
			? [{ name: 'Alicante', region: 'Valencia', country: 'España', lat: 38.35, lon: -0.48 }]
			: []
	)
}));
mock.module('comun/agenda.ts', () => ({ localDay: () => '2026-11-15' }));
const { describeWeather, heatingDegrees, coolingDegrees } = await import('./weather-read.ts');

const k = { familyId: 'A' } as Kitchen;
const realFetch = globalThis.fetch;
let asked: URL[] = [];
/** Open-Meteo's answer for the days asked: a cold day, a mild one, a hot one, each in turn. */
function fakeOpenMeteo() {
	asked = [];
	globalThis.fetch = (async (url: URL) => {
		asked.push(url);
		const from = url.searchParams.get('start_date')!;
		const to = url.searchParams.get('end_date')!;
		const time: string[] = [];
		for (
			let d = new Date(`${from}T12:00:00Z`);
			d.toISOString().slice(0, 10) <= to;
			d.setUTCDate(d.getUTCDate() + 1)
		)
			time.push(d.toISOString().slice(0, 10));
		const means = time.map((_, i) => [8, 16, 27][i % 3]!);
		return Response.json({
			daily: {
				time,
				weather_code: time.map(() => 0),
				temperature_2m_min: means.map((m) => m - 4),
				temperature_2m_max: means.map((m) => m + 4),
				temperature_2m_mean: means,
				precipitation_sum: time.map(() => 1.5)
			},
			hourly: url.searchParams.get('hourly')
				? {
						time: Array.from({ length: 24 }, (_, h) => `${from}T${String(h).padStart(2, '0')}:00`),
						temperature_2m: Array.from({ length: 24 }, (_, h) => 5 + h / 2)
					}
				: undefined
		});
	}) as typeof fetch;
}
afterEach(() => {
	globalThis.fetch = realFetch;
	home = null;
	searched.length = 0;
});

test('degree-days as Eurostat: heating at 15 °C or less, cooling at 24 °C or more', () => {
	expect([heatingDegrees(8), heatingDegrees(15), heatingDegrees(15.1)]).toEqual([10, 3, 0]);
	expect([coolingDegrees(27), coolingDegrees(24), coolingDegrees(23.9)]).toEqual([6, 3, 0]);
});

test('at home, each day with its degree-days and the period added up; recent days from the forecast API', async () => {
	home = {
		name: 'Vélez-Rubio',
		region: 'Andalucía',
		country: 'España',
		lat: 37.6,
		lon: -2.1,
		exact: true
	};
	fakeOpenMeteo();
	const said = await describeWeather(k, { from_day: '2026-11-01', to_day: '2026-11-06' });
	expect(asked[0]!.hostname).toBe('api.open-meteo.com');
	expect(asked[0]!.searchParams.get('hourly')).toBeNull();
	const lines = said.split('\n');
	expect(lines[0]).toContain('Vélez-Rubio, Andalucía, España, el punto exacto de casa');
	expect(lines[1]).toBe(
		'2026-11-01: 4 a 12 °C (media 8), despejado, 1,5 mm, 10 grados-día de calefacción'
	);
	expect(lines[2]).toBe('2026-11-02: 12 a 20 °C (media 16), despejado, 1,5 mm');
	expect(lines[3]).toBe('2026-11-03: 23 a 31 °C (media 27), despejado, 1,5 mm, 6 de refrigeración');
	expect(lines[7]).toBe(
		'Los 6 días ya pasados: media 17 °C, 9 mm de lluvia, 20 grados-día de calefacción y 12 de refrigeración.'
	);
});

test('a place named, a few days with the hours; days to come said as forecast', async () => {
	fakeOpenMeteo();
	const said = await describeWeather(k, {
		place: 'Alicante',
		from_day: '2026-11-15',
		to_day: '2026-11-16'
	});
	expect(searched).toEqual(['Alicante']);
	expect(said).toContain('El tiempo en Alicante, Valencia, España, del 2026-11-15 al 2026-11-16');
	expect(said).toContain('2026-11-15 (previsión): 4 a 12 °C');
	expect(said).toContain('Cada 3 horas: 2026-11-15 00:00 5 °C; 2026-11-15 03:00 6,5 °C');
	// Nothing gone yet: no total.
	expect(said).not.toContain('ya pasados');
});

test('older than three months, from the past forecasts, and nothing from today on', async () => {
	home = { name: 'Casa', region: null, country: null, lat: 37.6, lon: -2.1 };
	fakeOpenMeteo();
	await describeWeather(k, { from_day: '2025-01-01', to_day: '2025-01-31' });
	expect(asked[0]!.hostname).toBe('historical-forecast-api.open-meteo.com');
	expect(asked[0]!.searchParams.get('end_date')).toBe('2025-01-31');
});

test('what cannot be read is said: no home, an unknown place, too many days, bad days', async () => {
	expect(await describeWeather(k, { from_day: '2026-11-01' })).toContain('no ha dicho dónde vive');
	expect(await describeWeather(k, { place: 'Ninguna', from_day: '2026-11-01' })).toBe(
		'No encuentro ningún sitio llamado «Ninguna».'
	);
	home = { name: 'Casa', region: null, country: null, lat: 1, lon: 1 };
	expect(await describeWeather(k, { from_day: '2026-01-01', to_day: '2026-12-31' })).toContain(
		'Como mucho 92 días'
	);
	expect(await describeWeather(k, { from_day: 'ayer' })).toBe('Faltan los días, AAAA-MM-DD.');
	expect(await describeWeather(k, { from_day: '2027-03-01' })).toContain('demasiado lejos');
});
