import { addDays, localDay, localTime } from 'comun/agenda.ts';
import { nextStartDay } from '#lib/server/agenda/repeat.ts';

/** An alarm as kept (#241): its time and first day on the wall, its RRULE and days skipped. */
export interface AlarmTimes {
	time: string;
	startDay: string;
	repeat: string | null;
	skipDays: string[];
}

/**
 * When it rings next after `now`, in the house's zone (the server's `TZ`): its first day or one of
 * its repetitions (the Agenda's, `nextStartDay`), today only if its time has not come yet. Null:
 * never again (once, and gone).
 */
export function nextRing(alarm: AlarmTimes, now = new Date()): Date | null {
	const time = alarm.time.slice(0, 5);
	const today = localDay(now);
	const event = { ...alarm, endDay: null };
	let day = nextStartDay(event, today);
	if (day === today && time <= localTime(now)) day = nextStartDay(event, addDays(today, 1));
	// `YYYY-MM-DDTHH:MM` without a zone: the server's, the house's.
	return day ? new Date(`${day}T${time}`) : null;
}
