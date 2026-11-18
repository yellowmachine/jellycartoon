import { describe, expect, test } from 'bun:test';
import type { Alarm } from 'comun/alarms.ts';
import type { AgendaToday, Occurrence } from 'comun/agenda.ts';
import { todayLines } from '#lib/today-lines.ts';

const agenda = (events: Partial<Occurrence>[]): AgendaToday => ({
	day: '2026-11-18',
	people: [{ id: '1', name: 'Ana' }] as AgendaToday['people'],
	events: events.map((e, i) => ({
		eventId: i,
		day: '2026-11-18',
		title: `e${i}`,
		people: [],
		startTime: null,
		...e
	})) as Occurrence[]
});

describe('todayLines (#525)', () => {
	test('events and a timer, by their time, with who', () => {
		const now = new Date(2026, 10, 18, 10, 0, 0);
		const timer = {
			id: 7,
			label: 'Pasta',
			kind: 'temporizador',
			endsAt: now.getTime() + 6 * 60_000,
			people: [],
			ringingSince: null
		} as unknown as Alarm;
		const lines = todayLines(
			agenda([{ title: 'Dentista', startTime: '12:00', people: ['1'] }, { title: 'Cumple' }]),
			[timer],
			now
		);
		expect(lines.map((l) => l.title)).toEqual(['Cumple', 'Pasta', 'Dentista']);
		expect(lines[1].time).toBe('⏲️ quedan 6 min');
		expect(lines[2].who).toBe('Ana');
	});
});
