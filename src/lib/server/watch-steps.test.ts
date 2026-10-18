import { describe, expect, test } from 'bun:test';
import { MAX_STEP_SEC, WatchSteps } from './watch-steps.ts';

describe('WatchSteps', () => {
	test('what the position moved forward; not the first save, going back or a jump', () => {
		const steps = new WatchSteps();
		expect(steps.step('a', 100)).toBe(0);
		expect(steps.step('a', 110)).toBe(10);
		expect(steps.step('a', 105)).toBe(0);
		expect(steps.step('a', 105 + MAX_STEP_SEC + 1)).toBe(0);
		expect(steps.step('a', 175)).toBe(9);
	});

	test('two sources of the same episode at once both count (#45)', () => {
		const steps = new WatchSteps();
		const counted = [
			steps.step('kid:e1:salon', 500),
			steps.step('kid:e1:browser', 100),
			steps.step('kid:e1:salon', 510),
			steps.step('kid:e1:browser', 110),
			steps.step('kid:e1:salon', 520),
			steps.step('kid:e1:browser', 120)
		];
		expect(counted.reduce((a, b) => a + b)).toBe(40);
	});

	test('sources not heard from in an hour are forgotten', () => {
		const steps = new WatchSteps();
		const start = 0;
		for (let i = 0; i < 200; i++) steps.step(`old${i}`, 10, start);
		const later = start + 2 * 60 * 60 * 1000;
		steps.step('new', 10, later);
		expect(steps.size).toBe(1);
		// Still there for whoever goes on.
		expect(steps.step('new', 20, later + 10_000)).toBe(10);
	});
});
