import { describe, expect, test } from 'bun:test';
import type { LngLat } from './road.ts';
import { isDaytime, sunAltitude } from './sun.ts';

const MADRID: LngLat = [-3.7038, 40.4168];

describe('isDaytime', () => {
	// Madrid, 2026-11-01: solar noon about 11:58 UTC, the day 10 h 29 min long: sunrise about
	// 6:45 UTC (7:45 in Spain), sunset about 17:13 UTC (18:13).
	test('around sunrise and sunset in Madrid', () => {
		expect(isDaytime(MADRID, new Date('2026-11-01T06:30:00Z'))).toBe(false);
		expect(isDaytime(MADRID, new Date('2026-11-01T07:00:00Z'))).toBe(true);
		expect(isDaytime(MADRID, new Date('2026-11-01T17:00:00Z'))).toBe(true);
		expect(isDaytime(MADRID, new Date('2026-11-01T17:30:00Z'))).toBe(false);
	});

	test('noon and midnight', () => {
		expect(isDaytime(MADRID, new Date('2026-06-21T12:00:00Z'))).toBe(true);
		expect(isDaytime(MADRID, new Date('2026-06-21T23:30:00Z'))).toBe(false);
	});
});

test('the sun at noon in summer, as high as it gets in Madrid (~73°)', () => {
	expect(sunAltitude(MADRID, new Date('2026-06-21T12:15:00Z'))).toBeCloseTo(73, 0);
});
