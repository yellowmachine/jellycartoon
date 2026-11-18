import { parseClock } from 'comun/clock.ts';

/**
 * «Horas de silencio» (Ajustes → La voz): saved for the family, used by the voice (quiet-check.ts),
 * the rules' notices and the Vista's night (#525). Without the server's, for the browser too.
 */
export interface QuietHours {
	/** «HH:MM», from when; with `to`, it may go past midnight. */
	from: string;
	to: string;
}

/** Whether `minute` (of the day) falls in them. */
export function inQuietHours(config: QuietHours, minute: number) {
	const from = parseClock(config.from)!;
	const to = parseClock(config.to)!;
	return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}
