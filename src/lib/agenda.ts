/**
 * The house's agenda (#200), shared by the server and the pages: what an event is, its four
 * repeats, and days and times «on the wall» (`YYYY-MM-DD`, `HH:MM`), as they are said at home.
 */
import { isDay } from '#lib/expenses.ts';

export { isDay };

/** Monday first, as the week is said in Spain; Sunday is 6. */
export const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** The only four: not repeated, every week (on which days), every month, every year. */
export type Repeat =
	{ every: null } | { every: 'semana'; days: number[] } | { every: 'mes' } | { every: 'año' };

/** Its notice: an hour before, or the day before (at DAY_BEFORE_AT); null, none. */
export type Remind = 'hora' | 'dia' | null;

/** The day before, it is told at this time: «mañana, dentista a las 17:00». */
export const DAY_BEFORE_AT = '20:00';

export const MAX_TITLE = 120;
export const MAX_NOTES = 1000;

/** What a page sends to be saved. */
export interface EventInput {
	title: string;
	notes: string | null;
	startDay: string;
	/** Null: all day. */
	startTime: string | null;
	/** Its last day, if longer than one; null, the same day. */
	endDay: string | null;
	endTime: string | null;
	repeat: Repeat;
	remind: Remind;
	/** Who it is for: adults and children. */
	people: string[];
}

export interface AgendaEvent extends EventInput {
	id: number;
	/** The repetitions skipped, «esta vez no». */
	skipDays: string[];
	/** Who wrote it down. */
	by: string | null;
}

/** One of its repetitions, on the days it takes: what a week or a month shows. */
export interface Occurrence {
	eventId: number;
	title: string;
	/** The day this repetition starts, and its last. */
	day: string;
	lastDay: string;
	startTime: string | null;
	endTime: string | null;
	people: string[];
	repeats: boolean;
}

/** Someone of the house, with the drawing on their badge; an adult may have none. */
export interface AgendaPerson {
	id: string;
	name: string;
	kid: boolean;
	emoji: string | null;
	/** A Tailwind background, the drawing's. */
	color: string | null;
}

/** What the fridge shows (#200): today's, by the time they start; the day, for midnight. */
export interface AgendaToday {
	day: string;
	events: Occurrence[];
	people: AgendaPerson[];
}

/** `HH:MM`, a real time. */
export const isTime = (value: unknown): value is string =>
	typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** The RRULE (RFC 5545) of a repeat, for the database and the .ics; null, not repeated. */
export function toRrule(repeat: Repeat): string | null {
	switch (repeat.every) {
		case 'semana':
			return `FREQ=WEEKLY;BYDAY=${repeat.days.map((d) => RRULE_DAYS[d]).join(',')}`;
		case 'mes':
			return 'FREQ=MONTHLY';
		case 'año':
			return 'FREQ=YEARLY';
		default:
			return null;
	}
}

/** Back from the database: what it was saved as. */
export function fromRrule(rule: string | null): Repeat {
	if (!rule) return { every: null };
	if (rule.startsWith('FREQ=MONTHLY')) return { every: 'mes' };
	if (rule.startsWith('FREQ=YEARLY')) return { every: 'año' };
	const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]?.split(',') ?? [];
	return {
		every: 'semana',
		days: days
			.map((d) => RRULE_DAYS.indexOf(d as (typeof RRULE_DAYS)[number]))
			.filter((d) => d >= 0)
	};
}

const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

/** `day` plus `by` days. */
export function addDays(day: string, by: number) {
	const at = atNoon(day);
	at.setUTCDate(at.getUTCDate() + by);
	return at.toISOString().slice(0, 10);
}

/** Days from `a` to `b`. */
export const daysBetween = (a: string, b: string) =>
	Math.round((atNoon(b).getTime() - atNoon(a).getTime()) / 86_400_000);

/** 0 is Monday, 6 Sunday. */
export const weekday = (day: string) => (atNoon(day).getUTCDay() + 6) % 7;

/** The Monday of its week. */
export const mondayOf = (day: string) => addDays(day, -weekday(day));

/** `YYYY-MM-DD` of `date`, as it is in that place (not in UTC). */
export const localDay = (date = new Date()) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** `HH:MM` of `date`, in that place. */
export const localTime = (date = new Date()) =>
	`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** «jueves 30», or «jueves 30 de octubre» with `month`. */
export function dayName(day: string, month = false) {
	return atNoon(day).toLocaleDateString('es-ES', {
		weekday: 'long',
		day: 'numeric',
		...(month ? { month: 'long' } : {}),
		timeZone: 'UTC'
	});
}

/** «17:00», «17:00–18:30», or «Todo el día»: on the day it starts. */
export function timeText(o: Pick<Occurrence, 'startTime' | 'endTime' | 'day' | 'lastDay'>) {
	if (!o.startTime) return 'Todo el día';
	return o.endTime && o.day === o.lastDay ? `${o.startTime}–${o.endTime}` : o.startTime;
}

/** What it shows on one of its days: on its first, its time; then, until when. */
export function timeOn(o: Occurrence, day: string) {
	if (day === o.day) return timeText(o);
	if (day === o.lastDay && o.endTime) return `Hasta las ${o.endTime}`;
	return 'Todo el día';
}

/** Whether it takes `day`. */
export const takes = (o: Occurrence, day: string) => o.day <= day && day <= o.lastDay;

/** A day's, the all-day ones first, then by the time they start (on that day). */
export function dayEvents(occurrences: Occurrence[], day: string) {
	const at = (o: Occurrence) => (o.day === day && o.startTime ? o.startTime : '');
	return occurrences
		.filter((o) => takes(o, day))
		.sort((a, b) => at(a).localeCompare(at(b)) || a.title.localeCompare(b.title, 'es'));
}

/**
 * Over by `now` (`HH:MM`) on `day`: what ends then, at its end; what only says when it starts, an
 * hour later. An all-day one, never during its day.
 */
export function isOver(o: Occurrence, day: string, now: string) {
	if (day !== o.lastDay) return false;
	if (o.endTime) return now >= o.endTime;
	if (!o.startTime || o.day !== day) return false;
	const [h, m] = o.startTime.split(':').map(Number);
	const end = h! * 60 + m! + 60;
	if (end >= 24 * 60) return false;
	return (
		now >= `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
	);
}

/** «Cada martes y jueves», «Cada mes», «Cada año»; null, not repeated. */
export function repeatText(repeat: Repeat) {
	switch (repeat.every) {
		case 'semana': {
			const names = repeat.days.map((d) =>
				atNoon(addDays('2026-01-05', d)).toLocaleDateString('es-ES', {
					weekday: 'long',
					timeZone: 'UTC'
				})
			);
			if (names.length === 7) return 'Todos los días';
			const last = names.pop();
			return `Cada ${names.length ? `${names.join(', ')} y ${last}` : last}`;
		}
		case 'mes':
			return 'Cada mes';
		case 'año':
			return 'Cada año';
		default:
			return null;
	}
}

/** What a page sends, only if well formed; times without a day of their own are fixed up. */
export function parseEventInput(body: unknown): EventInput | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const title = typeof b.title === 'string' ? b.title.trim().slice(0, MAX_TITLE) : '';
	if (!title || !isDay(b.startDay)) return null;
	const startTime = isTime(b.startTime) ? b.startTime : null;
	let endDay = isDay(b.endDay) && b.endDay > b.startDay ? b.endDay : null;
	let endTime = startTime && isTime(b.endTime) ? b.endTime : null;
	// The same day, it ends after it starts.
	if (!endDay && endTime && endTime <= startTime!) endTime = null;

	let repeat: Repeat = { every: null };
	const r = b.repeat as Record<string, unknown> | null | undefined;
	if (r?.every === 'mes' || r?.every === 'año') repeat = { every: r.every };
	else if (r?.every === 'semana' && Array.isArray(r.days)) {
		const days = [...new Set(r.days)]
			.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) < 7)
			.sort();
		repeat = { every: 'semana', days: days.length ? days : [weekday(b.startDay)] };
	}
	// One repeated longer than its repeat would step on itself.
	if (endDay && repeat.every === 'semana' && daysBetween(b.startDay, endDay) >= 7) endDay = null;

	// An hour before, only with a time.
	const remind: Remind = b.remind === 'dia' || (b.remind === 'hora' && startTime) ? b.remind : null;
	const people = Array.isArray(b.people)
		? [...new Set(b.people.filter((p): p is string => typeof p === 'string'))]
		: [];
	const notes =
		typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, MAX_NOTES) : null;
	return {
		title,
		notes,
		startDay: b.startDay,
		startTime,
		endDay,
		endTime,
		repeat,
		remind,
		people
	};
}
