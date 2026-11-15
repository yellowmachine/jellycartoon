import { afterEach, expect, test } from 'bun:test';
import { sunOnPanels } from './weather.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('sun on panels: each value is the hour before its time; midnight closes the day before', async () => {
	let asked: URL | null = null;
	globalThis.fetch = (async (url: URL) => {
		asked = url;
		return Response.json({
			hourly: {
				time: ['2026-11-15T00:00', '2026-11-15T13:00', '2026-11-15T14:00', '2026-11-16T00:00'],
				global_tilted_irradiance: [0, 410.5, null, -0.1]
			}
		});
	}) as typeof fetch;
	const sun = await sunOnPanels(40.4, -3.7, 30, -45, '2026-11-15');
	expect(sun).toEqual([
		{ day: '2026-11-15', hour: 12, wm2: 410.5 },
		{ day: '2026-11-15', hour: 23, wm2: 0 }
	]);
	expect(asked!.searchParams.get('tilt')).toBe('30');
	expect(asked!.searchParams.get('azimuth')).toBe('-45');
	expect(asked!.searchParams.get('end_date')).toBe('2026-11-30');
});
