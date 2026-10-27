import { describe, expect, test } from 'bun:test';
import { toRrule } from '#lib/agenda.ts';
import { nextRing } from './next.ts';

/** In the test's zone, as the server's. */
const at = (local: string) => new Date(local);
const weekdays = toRrule({ every: 'semana', days: [0, 1, 2, 3, 4] });

describe('nextRing', () => {
	test('once: today if its time has not come, else never', () => {
		const once = { time: '07:30', startDay: '2026-10-27', repeat: null, skipDays: [] };
		expect(nextRing(once, at('2026-10-27T06:00'))).toEqual(at('2026-10-27T07:30'));
		expect(nextRing(once, at('2026-10-27T07:30'))).toBeNull();
		expect(nextRing(once, at('2026-10-26T23:00'))).toEqual(at('2026-10-27T07:30'));
	});

	test('on weekdays: the next one, past the weekend', () => {
		const alarm = { time: '07:30', startDay: '2026-10-26', repeat: weekdays, skipDays: [] };
		// Tuesday 27, later than its time: Wednesday.
		expect(nextRing(alarm, at('2026-10-27T08:00'))).toEqual(at('2026-10-28T07:30'));
		// Friday 30, after it: Monday 2.
		expect(nextRing(alarm, at('2026-10-30T09:00'))).toEqual(at('2026-11-02T07:30'));
	});

	test('a day skipped is passed by', () => {
		const alarm = {
			time: '07:30:00',
			startDay: '2026-10-26',
			repeat: weekdays,
			skipDays: ['2026-10-28']
		};
		expect(nextRing(alarm, at('2026-10-27T08:00'))).toEqual(at('2026-10-29T07:30'));
	});
});
