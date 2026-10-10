import { describe, expect, test } from 'bun:test';
import { frameTimes } from './birds-eye.ts';

describe('frameTimes', () => {
	test('a two-hour film: 20 frames past the logos and before the credits', () => {
		const times = frameTimes(7200);
		expect(times).toHaveLength(20);
		expect(times[0]).toBe(180);
		expect(times[19]).toBe(7200 - 360);
		// Evenly spread and increasing.
		const gaps = times.slice(1).map((t, i) => t - times[i]);
		expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
	});

	test('a short: smaller margins', () => {
		const times = frameTimes(480);
		expect(times[0]).toBe(20);
		expect(times[19]).toBe(440);
	});

	test('too short to skip anything: one frame in the middle', () => {
		expect(frameTimes(50)).toEqual([25]);
	});
});
