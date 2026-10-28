import { expect, test } from 'bun:test';
import { toRrule } from 'comun/agenda.ts';
import { nextStartDay, startDays } from './repeat.ts';

const once = { startDay: '2026-10-29', endDay: null, repeat: null, skipDays: [] };

test('not repeated: only if it takes the days looked at', () => {
	expect(startDays(once, '2026-10-26', '2026-11-01')).toEqual(['2026-10-29']);
	expect(startDays(once, '2026-11-02', '2026-11-08')).toEqual([]);
	const holidays = { ...once, startDay: '2026-08-03', endDay: '2026-08-10' };
	expect(startDays(holidays, '2026-08-10', '2026-08-16')).toEqual(['2026-08-03']);
	expect(startDays(holidays, '2026-08-11', '2026-08-16')).toEqual([]);
});

test('every Tuesday and Thursday, but not this Tuesday', () => {
	const english = {
		startDay: '2026-10-06',
		endDay: null,
		repeat: toRrule({ every: 'semana', days: [1, 3] }),
		skipDays: ['2026-10-27']
	};
	expect(startDays(english, '2026-10-26', '2026-11-01')).toEqual(['2026-10-29']);
	expect(startDays(english, '2026-11-02', '2026-11-08')).toEqual(['2026-11-03', '2026-11-05']);
	// Not before it was first.
	expect(startDays(english, '2026-09-28', '2026-10-04')).toEqual([]);
	expect(nextStartDay(english, '2026-10-27')).toBe('2026-10-29');
});

test('birthdays, every year; a change of the clocks moves nothing', () => {
	const birthday = { ...once, startDay: '2019-03-29', repeat: toRrule({ every: 'año' }) };
	expect(startDays(birthday, '2026-03-23', '2026-03-29')).toEqual(['2026-03-29']);
	expect(nextStartDay(birthday, '2026-03-30')).toBe('2027-03-29');
	const monthly = { ...once, startDay: '2026-10-25', repeat: toRrule({ every: 'mes' }) };
	expect(startDays(monthly, '2026-10-01', '2026-12-31')).toEqual([
		'2026-10-25',
		'2026-11-25',
		'2026-12-25'
	]);
});

test('a long one repeated, from before the days looked at', () => {
	const camp = {
		startDay: '2026-07-01',
		endDay: '2026-07-05',
		repeat: toRrule({ every: 'año' }),
		skipDays: []
	};
	expect(startDays(camp, '2027-07-04', '2027-07-10')).toEqual(['2027-07-01']);
});
