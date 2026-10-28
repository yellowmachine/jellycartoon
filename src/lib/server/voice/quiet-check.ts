import { parseClock } from '#lib/kid-time.ts';

/**
 * The «horas de silencio» check (quiet-hours.ts), apart from where they are saved: whether an order
 * may start something sounding now.
 */

export interface QuietHours {
	/** «HH:MM», from when; with `to`, it may go past midnight. */
	from: string;
	to: string;
}

/** After the question, how long its «sí» may take. */
const ANSWER_MS = 2 * 60_000;
/** After a «sí», the same place may put on something else without asking again for so long. */
const ALLOWED_MS = 30 * 60_000;

/** Whether `minute` (of the day) falls in them. */
export function inQuietHours(config: QuietHours, minute: number) {
	const from = parseClock(config.from)!;
	const to = parseClock(config.to)!;
	return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** By place (a satellite, a person's devices): the order that asked, or until when it may play. */
const asked = new Map<string, { order: string; at: number } | { until: number }>();

/**
 * Before something starts sounding by voice: null, it may; else what to tell the model. The first
 * order in the hours only asks; a later one, within `ANSWER_MS`, is the answer to that question.
 */
export function quietCheck(
	config: QuietHours | null,
	key: string,
	order: string,
	minute: number
): string | null {
	if (!config || !inQuietHours(config, minute)) return null;
	const t = Date.now();
	const last = asked.get(key);
	if (last && 'until' in last && t < last.until) return null;
	if (last && 'order' in last && last.order !== order && t - last.at < ANSWER_MS) {
		asked.set(key, { until: t + ALLOWED_MS });
		return null;
	}
	asked.set(key, { order, at: t });
	return `No se ha puesto: son horas de silencio en casa (de ${config.from} a ${config.to}), por si la orden se ha oído mal. Pregúntale con «ask» si lo pone de verdad, diciendo la hora y qué («Son las cuatro de la madrugada, ¿pongo Queen de verdad?»), con las opciones «Sí» (la orden completa: «Sí, pon Queen en toda la casa») y «No» (orden «No»). No hagas nada más en esta orden.`;
}
