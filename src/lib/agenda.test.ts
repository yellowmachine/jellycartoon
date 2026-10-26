import { expect, test } from 'bun:test';
import {
	dayEvents,
	fromRrule,
	isOver,
	mondayOf,
	parseEventInput,
	repeatText,
	toRrule,
	type Occurrence,
	type Repeat
} from './agenda.ts';

const at = (o: Partial<Occurrence>): Occurrence => ({
	eventId: 1,
	title: 'Dentista',
	day: '2026-10-26',
	lastDay: '2026-10-26',
	startTime: '17:00',
	endTime: null,
	people: [],
	repeats: false,
	...o
});

test('the four repeats, there and back', () => {
	for (const repeat of [
		{ every: null },
		{ every: 'semana', days: [1, 3] },
		{ every: 'mes' },
		{ every: 'año' }
	] satisfies Repeat[])
		expect(fromRrule(toRrule(repeat))).toEqual(repeat);
	expect(repeatText({ every: 'semana', days: [1, 3] })).toBe('Cada martes y jueves');
});

test('what a page sends, fixed up', () => {
	const ok = parseEventInput({
		title: '  Dentista ',
		startDay: '2026-10-29',
		startTime: '17:00',
		endTime: '16:00',
		remind: 'hora',
		repeat: { every: 'semana', days: [] },
		people: ['a', 'a', 3]
	});
	expect(ok).toMatchObject({
		title: 'Dentista',
		startTime: '17:00',
		// Before it starts: dropped.
		endTime: null,
		remind: 'hora',
		// No days: the day it starts on (a Thursday).
		repeat: { every: 'semana', days: [3] },
		people: ['a']
	});
	// All day: no notice an hour before.
	expect(
		parseEventInput({ title: 'Excursión', startDay: '2026-10-29', remind: 'hora' })?.remind
	).toBe(null);
	expect(parseEventInput({ title: '', startDay: '2026-10-29' })).toBeNull();
	expect(parseEventInput({ title: 'X', startDay: '2026-02-30' })).toBeNull();
});

test('a day: all-day first, then by the time', () => {
	const list = dayEvents(
		[
			at({ eventId: 1, startTime: '17:00' }),
			at({ eventId: 2, startTime: null }),
			at({ eventId: 3, startTime: '09:30' }),
			at({ eventId: 4, day: '2026-10-27', lastDay: '2026-10-27' })
		],
		'2026-10-26'
	);
	expect(list.map((o) => o.eventId)).toEqual([2, 3, 1]);
});

test('over: at its end, or an hour after it starts', () => {
	expect(isOver(at({}), '2026-10-26', '17:59')).toBe(false);
	expect(isOver(at({}), '2026-10-26', '18:00')).toBe(true);
	expect(isOver(at({ endTime: '17:30' }), '2026-10-26', '17:30')).toBe(true);
	expect(isOver(at({ startTime: null }), '2026-10-26', '23:59')).toBe(false);
	expect(isOver(at({ startTime: '23:30' }), '2026-10-26', '23:59')).toBe(false);
});

test('weeks start on Monday', () => {
	expect(mondayOf('2026-11-01')).toBe('2026-10-26');
	expect(mondayOf('2026-10-26')).toBe('2026-10-26');
});
