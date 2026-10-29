import { expect, test } from 'bun:test';
import { ringsToday, type Alarm } from './alarms.ts';

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m).getTime();
const alarm = (over: Partial<Alarm>): Alarm => ({
	id: 1,
	label: 'Sacar la basura',
	kind: 'alarma',
	endsAt: null,
	seconds: null,
	trigger: null,
	place: 'movil',
	time: '20:30',
	day: '2026-10-29',
	days: [],
	paused: false,
	nextAt: at(20, 30),
	ringingSince: null,
	doneAt: null,
	people: [],
	by: null,
	...over
});

test("«Hoy»: today's alarms, running timers and what rings now", () => {
	const now = new Date(at(17));
	expect(ringsToday(alarm({}), now)).toBe(true);
	expect(ringsToday(alarm({ nextAt: at(7, 0, 30) }), now)).toBe(false);
	expect(ringsToday(alarm({ paused: true }), now)).toBe(false);
	expect(ringsToday(alarm({ nextAt: null, ringingSince: at(16, 59) }), now)).toBe(true);
	expect(ringsToday(alarm({ kind: 'temporizador', nextAt: null, endsAt: at(17, 6) }), now)).toBe(
		true
	);
});
