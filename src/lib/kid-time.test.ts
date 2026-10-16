import { describe, expect, test } from 'bun:test';
import { closedText, openingText, parseClock, videoTime, type Slot } from './kid-time.ts';

const at = (weekday: number, time: string) => ({ weekday, minute: parseClock(time)! });
const slot = (weekday: number, start: string, end: string): Slot => ({
	weekday,
	startMinute: parseClock(start)!,
	endMinute: parseClock(end)!
});

// Monday to Friday 17:00–19:00, Saturday 10:00–13:00 and 17:00–20:00, Sunday nothing.
const week = [
	...[0, 1, 2, 3, 4].map((d) => slot(d, '17:00', '19:00')),
	slot(5, '10:00', '13:00'),
	slot(5, '17:00', '20:00')
];

describe('videoTime', () => {
	test('no slots and no limit: always', () => {
		expect(
			videoTime({ slots: [], dailyMinutes: null, access: 'yes' }, 99_999, at(6, '3:00'))
		).toEqual({
			allowed: true,
			until: null
		});
	});

	test('inside a slot, until its end', () => {
		expect(
			videoTime({ slots: week, dailyMinutes: null, access: 'yes' }, 0, at(2, '18:30'))
		).toEqual({
			allowed: true,
			until: parseClock('19:00')
		});
	});

	test('the end is not included', () => {
		const time = videoTime({ slots: week, dailyMinutes: null, access: 'yes' }, 0, at(2, '19:00'));
		expect(time.allowed).toBe(false);
	});

	test('before a slot: later today', () => {
		expect(
			videoTime({ slots: week, dailyMinutes: null, access: 'yes' }, 0, at(5, '14:00'))
		).toEqual({
			allowed: false,
			reason: 'schedule',
			next: { daysAhead: 0, minute: parseClock('17:00')! }
		});
	});

	test('a day without slots: the next day with one', () => {
		// Saturday night → Sunday has none → Monday 17:00.
		expect(
			videoTime({ slots: week, dailyMinutes: null, access: 'yes' }, 0, at(5, '21:00'))
		).toEqual({
			allowed: false,
			reason: 'schedule',
			next: { daysAhead: 2, minute: parseClock('17:00')! }
		});
	});

	test('the limit, inside a slot: not until the next day', () => {
		expect(
			videoTime({ slots: week, dailyMinutes: 60, access: 'yes' }, 3600, at(5, '11:00'))
		).toEqual({
			allowed: false,
			reason: 'limit',
			next: { daysAhead: 2, minute: parseClock('17:00')! }
		});
	});

	test('the limit without slots: tomorrow', () => {
		expect(videoTime({ slots: [], dailyMinutes: 30, access: 'yes' }, 1800, at(3, '12:00'))).toEqual(
			{
				allowed: false,
				reason: 'limit',
				next: { daysAhead: 1, minute: 0 }
			}
		);
	});

	test('«No»: no video, inside a slot too, and nothing said about when', () => {
		const time = videoTime({ slots: week, dailyMinutes: null, access: 'no' }, 0, at(2, '18:00'));
		expect(time).toEqual({ allowed: false, reason: 'off', next: null });
		expect(closedText(time as Extract<typeof time, { allowed: false }>, 2)).toBe(
			'Ahora no se pueden ver vídeos.'
		);
	});

	test("«No, hasta mañana»: back with tomorrow's first slot", () => {
		// Friday inside a slot → Saturday 10:00.
		expect(
			videoTime({ slots: week, dailyMinutes: null, access: 'until-tomorrow' }, 0, at(4, '18:00'))
		).toEqual({
			allowed: false,
			reason: 'off',
			next: { daysAhead: 1, minute: parseClock('10:00')! }
		});
	});

	test('«No, hasta mañana» without a schedule: back at midnight', () => {
		expect(
			videoTime({ slots: [], dailyMinutes: null, access: 'until-tomorrow' }, 0, at(3, '12:00'))
		).toEqual({
			allowed: false,
			reason: 'off',
			next: { daysAhead: 1, minute: 0 }
		});
	});

	test('under the limit', () => {
		expect(
			videoTime({ slots: [], dailyMinutes: 30, access: 'yes' }, 1799, at(3, '12:00')).allowed
		).toBe(true);
	});
});

test('openingText', () => {
	expect(openingText({ daysAhead: 0, minute: 1020 }, 2)).toBe('hoy a las 17:00');
	expect(openingText({ daysAhead: 1, minute: 0 }, 2)).toBe('mañana');
	expect(openingText({ daysAhead: 2, minute: 600 }, 3)).toBe('el sábado a las 10:00');
});

test('parseClock', () => {
	expect(parseClock('7:30')).toBe(450);
	expect(parseClock('24:00')).toBe(1440);
	expect(parseClock('24:30')).toBeNull();
	expect(parseClock('7:75')).toBeNull();
	expect(parseClock('mañana')).toBeNull();
});
