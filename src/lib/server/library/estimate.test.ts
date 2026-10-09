import { describe, expect, test } from 'bun:test';
import { estimateQueue } from './estimate.ts';

describe('estimateQueue', () => {
	test('nothing to do', () => {
		expect(estimateQueue({ speed: null, current: null, pending: [] })).toBe(0);
	});

	test('pending episodes at the historical speed', () => {
		expect(estimateQueue({ speed: 2, current: null, pending: [600, 1200] })).toBe(900);
	});

	test('the current episode from its own progress', () => {
		const current = { durationSec: 1200, elapsedSec: 100, progress: 0.25 };
		expect(estimateQueue({ speed: 10, current, pending: [] })).toBe(300);
	});

	test('just started: the current episode at the historical speed', () => {
		const current = { durationSec: 1200, elapsedSec: 0, progress: 0 };
		expect(estimateQueue({ speed: 4, current, pending: [] })).toBe(300);
	});

	test('no history: the queue at the current episode speed', () => {
		const current = { durationSec: 1200, elapsedSec: 100, progress: 0.25 };
		// 3 s of video per second: 300 s left of the current one plus 600 s for the queue.
		expect(estimateQueue({ speed: null, current, pending: [1800] })).toBe(900);
	});

	test('unknown durations count as the average of the known ones', () => {
		expect(estimateQueue({ speed: 1, current: null, pending: [100, null, 300] })).toBe(600);
	});

	test('no speed or no durations to go on', () => {
		expect(estimateQueue({ speed: null, current: null, pending: [600] })).toBeNull();
		expect(estimateQueue({ speed: 2, current: null, pending: [null] })).toBeNull();
		const starting = { durationSec: null, elapsedSec: 5, progress: 0 };
		expect(estimateQueue({ speed: 2, current: starting, pending: [] })).toBeNull();
	});
});
