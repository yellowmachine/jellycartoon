import { describe, expect, test } from 'bun:test';
import { frameTimes } from './birds-eye.ts';

describe('frameTimes', () => {
	test('a two-hour film: 20 frames past the logos and before the credits', () => {
		const times = frameTimes(7200, 1);
		expect(times).toHaveLength(20);
		expect(times[0]).toBeGreaterThanOrEqual(180);
		expect(times[19]).toBeLessThan(7200 - 360);
	});

	test('one frame in each stretch of the film, in order', () => {
		const times = frameTimes(7200, 42, 10);
		const stretch = (7200 - 180 - 360) / 10;
		times.forEach((at, i) => {
			expect(at).toBeGreaterThanOrEqual(Math.floor(180 + stretch * i));
			expect(at).toBeLessThan(180 + stretch * (i + 1));
		});
	});

	test('the same film always gets the same frames, another film others', () => {
		expect(frameTimes(7200, 7, 30)).toEqual(frameTimes(7200, 7, 30));
		expect(frameTimes(7200, 7, 30)).not.toEqual(frameTimes(7200, 8, 30));
	});

	test('a short: smaller margins', () => {
		const times = frameTimes(480, 3);
		expect(times[0]).toBeGreaterThanOrEqual(20);
		expect(times.at(-1)).toBeLessThan(440);
	});

	test('so short that seconds repeat: no repeated frames', () => {
		const times = frameTimes(75, 5, 30);
		expect(new Set(times).size).toBe(times.length);
	});

	test('too short to skip anything: one frame in the middle', () => {
		expect(frameTimes(50, 1)).toEqual([25]);
	});
});
