import { describe, expect, test } from 'bun:test';
import {
	checkSchedule,
	daysText,
	jobsFor,
	nextStart,
	sameTimespec,
	scheduleText,
	startsBetween
} from './plug-schedules.ts';

/** Plug schedules (#396): as said, and as the plug's own jobs. */
describe('plug schedules', () => {
	test('checked and tidied', () => {
		expect(checkSchedule({ days: [5, 1, 1, 9], start: '04:00', end: '07:00' })).toEqual({
			ok: { days: [1, 5], start: '04:00', end: '07:00' }
		});
		expect(checkSchedule({ days: [], start: '04:00', end: '07:00' })).toEqual({
			problem: 'Elige algún día'
		});
		expect(checkSchedule({ days: [1], start: '4:00', end: '07:00' })).toMatchObject({
			problem: 'Pon las dos horas'
		});
		expect(checkSchedule({ days: [1], start: '24:00', end: '07:00' })).toMatchObject({
			problem: 'Pon las dos horas'
		});
		expect(checkSchedule({ days: [1], start: '07:00', end: '07:00' })).toMatchObject({
			problem: 'La hora de apagar tiene que ser otra'
		});
	});

	test('said as the family says it', () => {
		expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('Todos los días');
		expect(daysText([1, 2, 3, 4, 5])).toBe('L a V');
		expect(daysText([6, 0])).toBe('S y D');
		expect(daysText([1, 3, 5])).toBe('L, X y V');
		expect(daysText([3])).toBe('X');
		expect(scheduleText({ days: [1, 2, 3, 4, 5], start: '04:00', end: '07:30' })).toBe(
			'L a V, de 4:00 a 7:30'
		);
		expect(scheduleText({ days: [5], start: '22:00', end: '06:00' })).toBe(
			'V, de 22:00 a 6:00 del día siguiente'
		);
	});

	test('on and off jobs; over midnight, off the next day', () => {
		expect(jobsFor([{ days: [1, 2, 3, 4, 5], start: '04:00', end: '07:30' }], true)).toEqual([
			{ timespec: '0 0 4 * * 1,2,3,4,5', on: true, enable: true },
			{ timespec: '0 30 7 * * 1,2,3,4,5', on: false, enable: true }
		]);
		expect(jobsFor([{ days: [0, 6], start: '22:15', end: '06:00' }], false)).toEqual([
			{ timespec: '0 15 22 * * 0,6', on: true, enable: false },
			{ timespec: '0 0 6 * * 0,1', on: false, enable: false }
		]);
	});

	test('the plug’s own zeros are the same time', () => {
		expect(sameTimespec('0 05 20 * * 6', '0 5 20 * * 6')).toBe(true);
		expect(sameTimespec('0 0 4 * * 1,2', '0 0 4 * * 1,3')).toBe(false);
	});
});

describe('skipping them (#557)', () => {
	// Weekdays at 18:00, weekends at 10:00; 2026-11-20 is a Friday.
	const termo = [
		{ days: [1, 2, 3, 4, 5], start: '18:00', end: '19:00' },
		{ days: [0, 6], start: '10:00', end: '11:00' }
	];

	test('only the «on» jobs off while skipping: nothing left on', () => {
		expect(jobsFor(termo.slice(0, 1), true, true).map((j) => [j.on, j.enable])).toEqual([
			[true, false],
			[false, true]
		]);
		expect(jobsFor(termo.slice(0, 1), false, true).every((j) => !j.enable)).toBe(true);
	});

	test('the switch-ons in a while, in order; its end not included', () => {
		expect(
			startsBetween(
				termo,
				{ day: '2026-11-20', time: '14:00' },
				{ day: '2026-11-20', time: '21:00' }
			)
		).toEqual([{ day: '2026-11-20', time: '18:00' }]);
		expect(
			startsBetween(
				termo,
				{ day: '2026-11-20', time: '14:00' },
				{ day: '2026-11-22', time: '23:59' }
			)
		).toEqual([
			{ day: '2026-11-20', time: '18:00' },
			{ day: '2026-11-21', time: '10:00' },
			{ day: '2026-11-22', time: '10:00' }
		]);
		expect(
			startsBetween(
				termo,
				{ day: '2026-11-20', time: '06:00' },
				{ day: '2026-11-20', time: '18:00' }
			)
		).toEqual([]);
	});

	test('the next one from now', () => {
		expect(nextStart(termo, { day: '2026-11-20', time: '17:00' })).toEqual({
			day: '2026-11-20',
			time: '18:00'
		});
		expect(nextStart(termo, { day: '2026-11-20', time: '18:00' })).toEqual({
			day: '2026-11-21',
			time: '10:00'
		});
		expect(nextStart([], { day: '2026-11-20', time: '17:00' })).toBeNull();
	});
});
