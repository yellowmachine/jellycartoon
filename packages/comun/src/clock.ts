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
