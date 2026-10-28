import { RRule } from 'rrule';
import { addDays, daysBetween } from 'comun/agenda.ts';

/**
 * The days an event's repetitions start on (#200), with the RRULE saved with it, by rrule
 * (https://github.com/jkbrzt/rrule). Days only, as dates at midnight in UTC: rrule's «floating»
 * times, so neither the server's zone nor a change of the clocks moves a day.
 */

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export interface Repeated {
	startDay: string;
	endDay: string | null;
	repeat: string | null;
	skipDays: string[];
}

/**
 * The start days of its repetitions that take some day from `from` to `to` (both included): a
 * long one that started before `from` too. Without the ones skipped.
 */
export function startDays(event: Repeated, from: string, to: string): string[] {
	const span = event.endDay ? daysBetween(event.startDay, event.endDay) : 0;
	if (!event.repeat) {
		const last = addDays(event.startDay, span);
		return event.startDay <= to && last >= from ? [event.startDay] : [];
	}
	const rule = new RRule({ ...RRule.parseString(event.repeat), dtstart: utc(event.startDay) });
	return rule
		.between(utc(addDays(from, -span)), utc(to), true)
		.map(dayOf)
		.filter((day) => !event.skipDays.includes(day));
}

/** The first one starting on `from` or after: for its notice. */
export function nextStartDay(event: Repeated, from: string): string | null {
	if (!event.repeat) return event.startDay >= from ? event.startDay : null;
	const rule = new RRule({ ...RRule.parseString(event.repeat), dtstart: utc(event.startDay) });
	let after = utc(from);
	// Skipped ones are passed by; a few, at most.
	for (let i = 0; i < 400; i++) {
		const next = rule.after(after, i === 0);
		if (!next) return null;
		const day = dayOf(next);
		if (!event.skipDays.includes(day)) return day;
		after = next;
	}
	return null;
}
