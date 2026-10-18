import { expect, test } from 'bun:test';
import { msUntilHour } from './schedule.ts';

test('msUntilHour: later today, or tomorrow once past', () => {
	const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m);
	expect(msUntilHour(3, at(1, 30))).toBe(90 * 60_000);
	expect(msUntilHour(3, at(3, 0))).toBe(24 * 3600_000);
	expect(msUntilHour(3, at(23, 0))).toBe(4 * 3600_000);
});
