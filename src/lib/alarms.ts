/**
 * Alarms and timers (#241), shared by the server and the Agenda's page: what one is, what a page
 * sends to set one, and how its days are said. Times and days «on the wall», as the Agenda's.
 */
import { isDay, isTime, WEEKDAYS } from '#lib/agenda.ts';
import { timeLabel } from '#lib/timer-names.ts';

export const MAX_ALARM_LABEL = 80;
/** A timer: a minute to a day. */
export const TIMER_MINUTES = { min: 1, max: 24 * 60 };

export type AlarmKind = 'temporizador' | 'alarma';

/** What a page sends: a timer of some minutes, or an alarm at a time on some weekdays (none, once). */
export type AlarmInput = { label: string; people: string[] } & (
	| { kind: 'temporizador'; minutes: number }
	| { kind: 'alarma'; time: string; day: string; days: number[] }
);

/** As the Agenda shows it. */
export interface Alarm {
	id: number;
	label: string;
	kind: AlarmKind;
	/** A timer's end (ms). */
	endsAt: number | null;
	/** An alarm's: its time, first day and weekdays (0 Monday; none, once). */
	time: string | null;
	day: string | null;
	days: number[];
	paused: boolean;
	/** When it rings next (ms); null, not again. */
	nextAt: number | null;
	ringingSince: number | null;
	doneAt: number | null;
	people: string[];
	by: string | null;
}

const text = (value: unknown, max: number) =>
	typeof value === 'string' ? value.trim().slice(0, max) : '';

/** From a page, only if well formed; a name made up if it has none («5 minutos»). */
export function parseAlarmInput(value: unknown): AlarmInput | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const people = Array.isArray(v.people)
		? [...new Set(v.people.filter((p): p is string => typeof p === 'string'))]
		: [];
	const label = text(v.label, MAX_ALARM_LABEL);
	if (v.kind === 'temporizador') {
		const minutes = Math.round(Number(v.minutes));
		if (!(minutes >= TIMER_MINUTES.min && minutes <= TIMER_MINUTES.max)) return null;
		return { kind: 'temporizador', minutes, label: label || timeLabel(minutes * 60), people };
	}
	if (v.kind === 'alarma') {
		if (!isTime(v.time) || !isDay(v.day)) return null;
		const days = Array.isArray(v.days)
			? [
					...new Set(v.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))
				].sort()
			: [];
		return {
			kind: 'alarma',
			time: v.time,
			day: v.day,
			days,
			label: label || `Alarma de las ${v.time}`,
			people
		};
	}
	return null;
}

/** «Todos los días», «De lunes a viernes», «L, X, V»; empty, once. */
export function daysName(days: number[]) {
	const key = [...days].sort().join('');
	if (key === '0123456') return 'Todos los días';
	if (key === '01234') return 'De lunes a viernes';
	if (key === '56') return 'Fines de semana';
	return days.map((d) => WEEKDAYS[d]).join(', ');
}
