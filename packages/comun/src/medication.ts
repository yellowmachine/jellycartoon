import { isDay, isTime, weekday, WEEKDAYS } from './agenda.ts';

/**
 * The family's medication (#308): what each person takes, at what times and on which days, and
 * the day's doses to mark as taken.
 */

export const MAX_NAME = 80;
export const MAX_DOSE = 80;
export const MAX_TIMES = 8;

export interface MedicationInput {
	personId: string;
	name: string;
	dose: string | null;
	/** `HH:MM`, in order. */
	times: string[];
	/** Weekdays (0, Monday); none, every day. */
	days: number[];
	startDay: string;
	endDay: string | null;
}

export interface Medication extends MedicationInput {
	id: number;
}

export interface Dose {
	medicationId: number;
	personId: string;
	name: string;
	dose: string | null;
	day: string;
	time: string;
	/** `HH:MM` it was marked, and by whom; null, not yet. */
	takenAt: string | null;
	takenBy: string | null;
}

/** Whether it is taken on `day`: from its first to its last, on its weekdays. */
export const takenOn = (m: Pick<MedicationInput, 'days' | 'startDay' | 'endDay'>, day: string) =>
	m.startDay <= day &&
	(m.endDay === null || day <= m.endDay) &&
	(m.days.length === 0 || m.days.includes(weekday(day)));

/** The day's doses of these, by time; without what was marked. */
export function dosesOn(meds: Medication[], day: string) {
	return meds
		.filter((m) => takenOn(m, day))
		.flatMap((m) => m.times.map((time) => ({ medication: m, time })))
		.sort((a, b) => a.time.localeCompare(b.time) || a.medication.id - b.medication.id);
}

/** «Todos los días», «L, X, V». */
export function daysText(days: number[]) {
	return days.length === 0 || days.length === 7
		? 'Todos los días'
		: [...days]
				.sort((a, b) => a - b)
				.map((d) => WEEKDAYS[d])
				.join(', ');
}

/** As the page sends it; null if something is missing or wrong. */
export function parseMedicationInput(body: unknown): MedicationInput | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const name = typeof b.name === 'string' ? b.name.trim().slice(0, MAX_NAME) : '';
	const dose = typeof b.dose === 'string' ? b.dose.trim().slice(0, MAX_DOSE) : '';
	const times = Array.isArray(b.times)
		? [...new Set(b.times.filter(isTime).map((t) => t.slice(0, 5)))].sort().slice(0, MAX_TIMES)
		: [];
	const days = Array.isArray(b.days)
		? [...new Set(b.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
				(a, b) => a - b
			)
		: [];
	const personId = typeof b.personId === 'string' ? b.personId : '';
	if (!name || !times.length || !personId || !isDay(b.startDay)) return null;
	const endDay = isDay(b.endDay) && b.endDay >= b.startDay ? b.endDay : null;
	return {
		personId,
		name,
		dose: dose || null,
		times,
		days: days.length === 7 ? [] : days,
		startDay: b.startDay,
		endDay
	};
}
