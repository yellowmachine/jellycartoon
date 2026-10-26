import { expect, test } from 'bun:test';
import { toIcs, type IcsEvent } from './ics.ts';

const base: IcsEvent = {
	id: 7,
	title: 'Dentista',
	notes: null,
	names: 'Lucía y Pablo',
	startDay: '2026-10-26',
	startTime: '17:00',
	endDay: null,
	endTime: null,
	repeatRule: null,
	skipDays: [],
	createdAt: new Date('2026-10-20T09:30:00Z')
};

const ics = (e: IcsEvent) => toIcs([e], { host: 'casa', zone: 'Europe/Madrid' });

test('a time on the wall, an hour long if it does not say', () => {
	const out = ics(base);
	expect(out).toContain('DTSTART:20261026T170000\r\n');
	expect(out).toContain('DTEND:20261026T180000\r\n');
	expect(out).toContain('UID:evento-7@casa\r\n');
	expect(out).toContain('DESCRIPTION:Para: Lucía y Pablo\r\n');
	expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
});

test('all day, from the 3rd to the 10th: it ends the day after', () => {
	const out = ics({
		...base,
		title: 'Vacaciones',
		startTime: null,
		startDay: '2026-08-03',
		endDay: '2026-08-10'
	});
	expect(out).toContain('DTSTART;VALUE=DATE:20260803\r\n');
	expect(out).toContain('DTEND;VALUE=DATE:20260811\r\n');
});

test('repeated, without the days skipped; text escaped and long lines folded', () => {
	const out = ics({
		...base,
		title: 'Inglés, en la academia; con libro',
		repeatRule: 'FREQ=WEEKLY;BYDAY=TU,TH',
		skipDays: ['2026-10-27'],
		notes: 'x'.repeat(100)
	});
	expect(out).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH\r\n');
	expect(out).toContain('EXDATE:20261027T170000\r\n');
	expect(out).toContain('SUMMARY:Inglés\\, en la academia\\; con libro\r\n');
	for (const line of out.split('\r\n'))
		expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
});
