import { localDay, localTime } from 'comun/agenda.ts';

/**
 * «Compañía» (#469), what the clock does next for a family, from its row and whether a satellite
 * that can ask is there. Pure, to be tested: companion.ts does it.
 */

export interface CompanionState {
	on: boolean;
	everyMinutes: number;
	/** «HH:MM» on the wall. */
	fromTime: string;
	toTime: string;
	retries: number;
	retryMinutes: number;
	pausedUntil: Date | null;
	lastSignalAt: Date | null;
	lastCheckAt: Date | null;
	attempt: number;
	askedAt: Date | null;
	alertKind: 'silent' | 'offline' | null;
	offlineSince: Date | null;
}

/**
 * Whether a satellite that may ask is connected: `ready`; connected, but its image cannot ask yet
 * (`old`, to be updated); or none.
 */
export type Presence = 'ready' | 'old' | 'none';

export type Step =
	| 'none'
	/** A new asking. */
	| 'ask'
	/** Asked again: no answer to the last. */
	| 'retry'
	/** No answer to any: the linked families told. */
	| 'give-up'
	/** The asking going on dropped, without counting: paused, or no satellite to ask. */
	| 'drop'
	/** No satellite since now: the linked families are told only after a while (`OFFLINE_GRACE_MS`). */
	| 'offline-start'
	/** No satellite for a while: the linked families told. */
	| 'offline-alert'
	/** A satellite again: forgotten, and the linked families told if they knew. */
	| 'online';

/** A satellite away this long, within the hours: a restart of Seilide or the network is shorter. */
export const OFFLINE_GRACE_MS = 10 * 60_000;

const minutesOf = (hhmm: string) => {
	const [h = 0, m = 0] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

/** Within its hours: from `fromTime` to `toTime`, also across midnight if set so. */
export function inHours(s: Pick<CompanionState, 'fromTime' | 'toTime'>, now: Date) {
	const at = minutesOf(localTime(now));
	const from = minutesOf(s.fromTime);
	const to = minutesOf(s.toTime);
	return from <= to ? at >= from && at < to : at >= from || at < to;
}

/**
 * Time for a new asking: never asked, or the last sign was before today's hours started (the first
 * of the day, as they begin), or as long ago as it is set.
 */
export function due(s: CompanionState, now: Date) {
	const times = [s.lastSignalAt, s.lastCheckAt].filter((d): d is Date => d !== null);
	if (!times.length) return true;
	const last = new Date(Math.max(...times.map((d) => d.getTime())));
	if (localDay(last) !== localDay(now) || minutesOf(localTime(last)) < minutesOf(s.fromTime))
		return true;
	return now.getTime() - last.getTime() >= s.everyMinutes * 60_000;
}

export function nextStep(s: CompanionState, presence: Presence, now: Date): Step {
	if (!s.on) return s.attempt > 0 ? 'drop' : 'none';
	if (s.pausedUntil && s.pausedUntil > now) return s.attempt > 0 ? 'drop' : 'none';
	const hours = inHours(s, now);
	if (presence !== 'ready') {
		if (s.attempt > 0) return 'drop';
		// At night no one is told the satellite is gone; in the morning, if it still is.
		if (!hours) return 'none';
		if (!s.offlineSince) return 'offline-start';
		if (s.alertKind !== 'offline' && now.getTime() - s.offlineSince.getTime() >= OFFLINE_GRACE_MS)
			return 'offline-alert';
		return 'none';
	}
	if (s.offlineSince || s.alertKind === 'offline') return 'online';
	if (s.attempt > 0) {
		if (!s.askedAt || now.getTime() - s.askedAt.getTime() < s.retryMinutes * 60_000) return 'none';
		return s.attempt <= s.retries ? 'retry' : 'give-up';
	}
	return hours && due(s, now) ? 'ask' : 'none';
}

/** Minutes from now until `hhmm` on the wall tomorrow: «Pausar hasta mañana». */
export function minutesToTomorrow(hhmm: string, now: Date) {
	return 24 * 60 - minutesOf(localTime(now)) + minutesOf(hhmm);
}
