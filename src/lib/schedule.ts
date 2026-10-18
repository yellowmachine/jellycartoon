/** Milliseconds from `now` until the next time it is `hour` o'clock, in local time. */
export function msUntilHour(hour: number, now = new Date()) {
	const next = new Date(now);
	next.setHours(hour, 0, 0, 0);
	if (next <= now) next.setDate(next.getDate() + 1);
	return next.getTime() - now.getTime();
}
