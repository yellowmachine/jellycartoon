import { afterEach, expect, test } from 'bun:test';
import { outsideWeather } from './weather.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('outside: now, today, and the hours up to this one (the rest of today is a forecast)', async () => {
	let asked: URL | null = null;
	globalThis.fetch = (async (url: URL) => {
		asked = url;
		return Response.json({
			current: { temperature_2m: 12.24, relative_humidity_2m: 82.6 },
			hourly: {
				time: ['2026-11-15T09:00', '2026-11-15T10:00', '2026-11-15T11:00', '2026-11-15T12:00'],
				temperature_2m: [11.04, null, 12.66, 14]
			},
			daily: {
				time: ['2026-11-14', '2026-11-15'],
				temperature_2m_min: [8, 9.6],
				temperature_2m_max: [15, 16.4]
			}
		});
	}) as typeof fetch;
	// 11:30 in Madrid.
	const w = await outsideWeather(40.4, -3.7, new Date('2026-11-15T10:30:00Z'));
	expect(w).toEqual({
		temperature: 12.2,
		humidity: 83,
		min: 10,
		max: 16,
		hours: [
			{ at: '2026-11-15T09:00', temperature: 11 },
			{ at: '2026-11-15T11:00', temperature: 12.7 }
		]
	});
	expect(asked!.searchParams.get('past_days')).toBe('30');
});
