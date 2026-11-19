import { dayName, MAX_NOTES, MAX_TITLE } from 'comun/agenda.ts';

/**
 * A plan proposed in Mensajes (#555), «¿quedamos el sábado a comer?»: made by the AI in its panel,
 * sent in a message, and added with a touch to the Agenda of whoever gets it. One day, its time if
 * it has one; nothing repeated.
 */
export interface Cita {
	title: string;
	/** YYYY-MM-DD. */
	day: string;
	/** HH:MM; null, all day. */
	time: string | null;
	endTime: string | null;
	notes: string | null;
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A plan that is one, from the AI's arguments (`end_time`) or as saved (`endTime`). */
export function parseCita(value: unknown): Cita | null {
	const v = (value ?? {}) as Record<string, unknown>;
	const title = typeof v.title === 'string' ? v.title.trim().slice(0, MAX_TITLE) : '';
	const day = typeof v.day === 'string' && DAY.test(v.day) ? v.day : null;
	if (!title || !day) return null;
	const time = typeof v.time === 'string' && TIME.test(v.time) ? v.time : null;
	const end = v.endTime ?? v.end_time;
	const endTime = time && typeof end === 'string' && TIME.test(end) && end > time ? end : null;
	const notes =
		typeof v.notes === 'string' && v.notes.trim() ? v.notes.trim().slice(0, MAX_NOTES) : null;
	return { title, day, time, endTime, notes };
}

/** «sábado 22 de noviembre, 14:00–17:00». */
export const citaWhen = (c: Cita) =>
	`${dayName(c.day, true)}${c.time ? `, ${c.time}${c.endTime ? `–${c.endTime}` : ''}` : ''}`;

/** The same plan already in an Agenda: by its day, time and title, whatever the case. */
export const citaKey = (c: { day: string; time: string | null; title: string }) =>
	`${c.day}|${c.time ?? ''}|${c.title.trim().toLowerCase()}`;
