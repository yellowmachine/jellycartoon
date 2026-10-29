/**
 * Alarms and timers (#241), shared by the server and the Agenda's page: what one is, what a page
 * sends to set one, and how its days are said. Times and days «on the wall», as the Agenda's.
 */
import { isDay, isTime, WEEKDAYS } from 'comun/agenda.ts';
import { timeLabel } from 'comun/timer-names.ts';

export const MAX_ALARM_LABEL = 80;
/** «Posponer»: in so many minutes if not said, at most `MAX_SNOOZE_MIN`. */
export const SNOOZE_MIN = 10;
export const MAX_SNOOZE_MIN = 60;
/** Most days skipped or unskipped at once: a long holiday. */
export const MAX_SKIP_DAYS = 92;
/** A timer: a minute to a day. */
export const TIMER_MINUTES = { min: 1, max: 24 * 60 };

export type AlarmKind = 'temporizador' | 'alarma' | 'preparado';

/**
 * Where one sounds: the whole house (Snapcast), or a voice satellite, by its id (#223); or only
 * the phones of whom it is for (`movil`, a notice): a timer said to the cloud (#253).
 */
export type AlarmPlace = 'casa' | 'movil' | `satelite:${string}`;

export const isAlarmPlace = (value: unknown): value is AlarmPlace =>
	value === 'casa' ||
	value === 'movil' ||
	(typeof value === 'string' && /^satelite:[\w-]{1,100}$/.test(value));

/** What a page sends: a timer of some minutes, or an alarm at a time on some weekdays (none, once). */
export type AlarmInput = { label: string; people: string[]; place: AlarmPlace } & (
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
	/** A prepared one's: how long, and what it waits for. */
	seconds: number | null;
	trigger: string | null;
	place: AlarmPlace;
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
	const place = isAlarmPlace(v.place) ? v.place : 'casa';
	if (v.kind === 'temporizador') {
		const minutes = Math.round(Number(v.minutes));
		if (!(minutes >= TIMER_MINUTES.min && minutes <= TIMER_MINUTES.max)) return null;
		return {
			kind: 'temporizador',
			minutes,
			label: label || timeLabel(minutes * 60),
			people,
			place
		};
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
			people,
			place
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

/** Rings today (an alarm), or counts down now (a timer): the «Hoy» list's. */
export function ringsToday(alarm: Alarm, now = new Date()) {
	if (alarm.ringingSince) return true;
	if (alarm.kind === 'temporizador') return alarm.endsAt !== null;
	if (alarm.paused || alarm.nextAt === null) return false;
	const end = new Date(now);
	end.setHours(24, 0, 0, 0);
	return alarm.nextAt < end.getTime();
}
