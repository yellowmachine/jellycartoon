import { isOver, localTime, timeOn, type AgendaToday } from 'comun/agenda.ts';
import type { Alarm } from 'comun/alarms.ts';

/**
 * «Hoy», as the home page and the Vista (#525) show it: today's agenda with the alarms and timers
 * that ring today, by their time (the whole day's first).
 */
export interface TodayLine {
	key: string;
	/** `HH:MM`, to sort them. */
	at: string;
	/** What is shown before it: its time, «Sonando», what a timer has left. */
	time: string;
	title: string;
	who: string;
	over: boolean;
	ringing: boolean;
}

/** «quedan 6 min», «quedan 40 s». */
function left(endsAt: number, now: Date) {
	const s = Math.max(0, Math.round((endsAt - now.getTime()) / 1000));
	return s >= 60 ? `quedan ${Math.ceil(s / 60)} min` : `quedan ${s} s`;
}

const clockOf = (ms: number) => localTime(new Date(ms));

export function todayLines(agenda: AgendaToday, alarms: Alarm[], now: Date): TodayLine[] {
	const today = agenda.day;
	const nameOf = (id: string) => agenda.people.find((p) => p.id === id)?.name ?? null;
	const whoOf = (people: string[]) => people.map(nameOf).filter(Boolean).join(', ');
	const events = agenda.events.map((o) => ({
		key: `e${o.eventId}-${o.day}`,
		at: o.day === today && o.startTime ? o.startTime : '00:00',
		time: timeOn(o, today),
		title: o.title,
		who: whoOf(o.people),
		over: isOver(o, today, localTime(now)),
		ringing: false
	}));
	const rings = alarms.map((a) => {
		const timer = a.kind === 'temporizador';
		const at = timer ? (a.endsAt ?? now.getTime()) : (a.nextAt ?? now.getTime());
		return {
			key: `a${a.id}`,
			at: clockOf(at),
			time: a.ringingSince ? 'Sonando' : timer ? `⏲️ ${left(at, now)}` : `⏰ ${clockOf(at)}`,
			title: a.label,
			who: whoOf(a.people),
			over: false,
			ringing: Boolean(a.ringingSince)
		};
	});
	return [...events, ...rings].sort((a, b) => a.at.localeCompare(b.at));
}
