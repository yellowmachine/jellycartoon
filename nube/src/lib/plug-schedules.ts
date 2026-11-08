/**
 * When a plug goes on and off by itself (#396), shared by the page and the server: what a schedule
 * is, how it is said («L a V, de 4:00 a 7:00»), and the plug's own jobs that carry it out. The plug
 * keeps them, so they run without Seilide or internet, in its own time zone (set to the family's).
 * Its cron has seconds first and 0 Sunday … 6 Saturday, as tried on a Plug M Gen3 on 2026-11-07.
 */

export interface PlugScheduleInput {
	/** 0 Sunday … 6 Saturday. */
	days: number[];
	/** «HH:MM». */
	start: string;
	end: string;
}

export interface PlugScheduleView extends PlugScheduleInput {
	id: number;
}

/** The plug keeps 20 jobs; each schedule takes two (on and off). */
export const MAX_SCHEDULES = 10;

/** The week as the family reads it, Monday first, with the plug's numbers. */
export const WEEK = [
	{ day: 1, short: 'L', name: 'lunes' },
	{ day: 2, short: 'M', name: 'martes' },
	{ day: 3, short: 'X', name: 'miércoles' },
	{ day: 4, short: 'J', name: 'jueves' },
	{ day: 5, short: 'V', name: 'viernes' },
	{ day: 6, short: 'S', name: 'sábado' },
	{ day: 0, short: 'D', name: 'domingo' }
] as const;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A schedule that makes sense, tidied (days once, in order), or why not. */
export function checkSchedule(
	input: PlugScheduleInput
): { ok: PlugScheduleInput } | { problem: string } {
	const days = [...new Set(input.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
	if (!days.length) return { problem: 'Elige algún día' };
	if (!TIME.test(input.start) || !TIME.test(input.end)) return { problem: 'Pon las dos horas' };
	if (input.start === input.end) return { problem: 'La hora de apagar tiene que ser otra' };
	days.sort((a, b) => a - b);
	return { ok: { days, start: input.start, end: input.end } };
}

/** «4:00» from «04:00». */
const hourText = (time: string) => time.replace(/^0(\d)/, '$1');

/** The days as said: «Todos los días», «L a V», «S y D», «L, X y V». */
export function daysText(days: number[]) {
	const order = WEEK.filter((w) => days.includes(w.day));
	if (order.length === 7) return 'Todos los días';
	const positions = order.map((w) => WEEK.indexOf(w));
	const inARow = positions.every((p, i) => i === 0 || p === positions[i - 1]! + 1);
	if (order.length >= 3 && inARow) return `${order[0]!.short} a ${order.at(-1)!.short}`;
	const shorts = order.map((w) => w.short);
	return shorts.length === 1 ? shorts[0]! : `${shorts.slice(0, -1).join(', ')} y ${shorts.at(-1)}`;
}

/** «L a V, de 4:00 a 7:00»; ending the next day, says so. */
export function scheduleText(s: PlugScheduleInput) {
	const nextDay = s.end < s.start ? ' del día siguiente' : '';
	return `${daysText(s.days)}, de ${hourText(s.start)} a ${hourText(s.end)}${nextDay}`;
}

/** A job of the plug's: when, on or off, and whether it runs. */
export interface PlugJob {
	timespec: string;
	on: boolean;
	enable: boolean;
}

const cron = (time: string, days: number[]) => {
	const [hour, minute] = time.split(':').map(Number);
	return `0 ${minute} ${hour} * * ${days.join(',')}`;
};

/**
 * The jobs that carry these schedules out: one on and one off each. An off that comes before its
 * on is the next day's. All off while `enable` is false (paused, or heating).
 */
export function jobsFor(schedules: PlugScheduleInput[], enable: boolean): PlugJob[] {
	return schedules.flatMap((s) => {
		const offDays = s.end < s.start ? s.days.map((d) => (d + 1) % 7).sort((a, b) => a - b) : s.days;
		return [
			{ timespec: cron(s.start, s.days), on: true, enable },
			{ timespec: cron(s.end, offDays), on: false, enable }
		];
	});
}

/** Its timespec as the plug gives it back, with its own zeros: «0 05 20 * * 6» is «0 5 20 * * 6». */
export const sameTimespec = (a: string, b: string) =>
	a
		.split(/\s+/)
		.map((f) => f.replace(/^0+(\d)/, '$1'))
		.join(' ') ===
	b
		.split(/\s+/)
		.map((f) => f.replace(/^0+(\d)/, '$1'))
		.join(' ');
