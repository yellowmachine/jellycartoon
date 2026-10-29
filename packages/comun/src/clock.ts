/** Times of the day, as people write them (the children's hours, the voice's «horas de silencio»). */

/** `minute` as `17:05`. */
export function clock(minute: number) {
	return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
}

/** `17:05` as minutes; null if it is not a time. `24:00` is the end of the day. */
export function parseClock(text: string) {
	const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!match) return null;
	const minute = Number(match[1]) * 60 + Number(match[2]);
	return Number(match[2]) < 60 && minute <= 1440 ? minute : null;
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** «de la madrugada», «de la tarde»…: a bare «4:41» was read as the afternoon by a model that does not think. */
function dayPart(minute: number) {
	const hour = Math.floor(minute / 60);
	if (hour < 6) return 'de la madrugada';
	if (hour < 13) return 'de la mañana';
	if (hour < 15) return 'del mediodía';
	if (hour < 21) return 'de la tarde';
	return 'de la noche';
}

/**
 * Today and now, for «el viernes pasado», in the server's zone (`TZ`): not in cached instructions,
 * it changes every minute.
 */
export function todayText(date = new Date()) {
	const minute = date.getHours() * 60 + date.getMinutes();
	const day = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
	return `Hoy es ${WEEKDAYS[(date.getDay() + 6) % 7]} ${day}, son las ${clock(minute).padStart(5, '0')} en 24 horas (${dayPart(minute)}). Las semanas empiezan en lunes.`;
}
