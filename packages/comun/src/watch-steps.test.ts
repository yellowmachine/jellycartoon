import { describe, expect, test } from 'bun:test';
import { WatchSteps } from './watch-steps.ts';

const s = (seconds: number) => seconds * 1000;

describe('WatchSteps', () => {
	test('what the position moved forward; not the first save, nor going back', () => {
		const steps = new WatchSteps();
		expect(steps.step('a', 100, s(0))).toBe(0);
		expect(steps.step('a', 110, s(10))).toBe(10);
		expect(steps.step('a', 105, s(15))).toBe(0);
		expect(steps.step('a', 115, s(25))).toBe(10);
	});

	test('jumping ahead counts only the time that went by (#45)', () => {
		const steps = new WatchSteps();
		steps.step('a', 100, s(0));
		// 5 seconds watched, then 50 skipped.
		expect(steps.step('a', 155, s(5))).toBe(6);
		// Half an hour ahead, in a moment.
		expect(steps.step('a', 1955, s(6))).toBe(2);
	});

	test('saves far apart (a hidden tab saves once a minute) still count', () => {
		const steps = new WatchSteps();
		steps.step('a', 0, s(0));
		expect(steps.step('a', 120, s(120))).toBe(120);
	});

	test('paused a long while, then a few seconds: only those', () => {
		const steps = new WatchSteps();
		steps.step('a', 300, s(0));
		expect(steps.step('a', 310, s(1800))).toBe(10);
	});

	test('two sources of the same episode at once both count (#45)', () => {
		const steps = new WatchSteps();
		const counted = [
			steps.step('kid:e1:salon', 500, s(0)),
			steps.step('kid:e1:browser', 100, s(1)),
			steps.step('kid:e1:salon', 510, s(10)),
			steps.step('kid:e1:browser', 110, s(11)),
			steps.step('kid:e1:salon', 520, s(20)),
			steps.step('kid:e1:browser', 120, s(21))
		];
		expect(counted.reduce((a, b) => a + b)).toBe(40);
	});

	test('sources not heard from in an hour are forgotten', () => {
		const steps = new WatchSteps();
		for (let i = 0; i < 200; i++) steps.step(`old${i}`, 10, 0);
		const later = s(2 * 60 * 60);
		steps.step('new', 10, later);
		expect(steps.size).toBe(1);
		// Still there for whoever goes on.
		expect(steps.step('new', 20, later + s(10))).toBe(10);
	});
});
