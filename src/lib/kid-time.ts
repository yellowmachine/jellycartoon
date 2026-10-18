/**
 * When a child may watch video (#18): slots per weekday and a daily limit. Pure, shared by the
 * server, which enforces it, and the pages, which explain it.
 */

export interface Slot {
	/** 0 Monday … 6 Sunday. */
	weekday: number;
	/** Minutes since midnight; the end is not included. */
	startMinute: number;
	endMinute: number;
}

/** «Puede ver vídeos»: yes, no, or not until tomorrow. */
export type VideoAccess = 'yes' | 'no' | 'until-tomorrow';

export interface KidRules {
	slots: Slot[];
	/** null: no limit. */
	dailyMinutes: number | null;
	/** Over the schedule and the limit: with anything but `yes`, no video. */
	access: VideoAccess;
}

/** A moment in the server's time zone. */
export interface Moment {
	weekday: number;
	minute: number;
}

/** When it opens again: in `daysAhead` days (0 today), at `minute`. */
export interface Opening {
	daysAhead: number;
	minute: number;
}

export type VideoTime =
	| {
			allowed: true;
			/** The current slot ends then, today; null: no slot, no end. */ until: number | null;
	  }
	| { allowed: false; reason: 'schedule' | 'limit' | 'off'; next: Opening | null };

/** The time watched is kept in slots of this many minutes (`watch_time.minute`). */
export const SLOT_MINUTES = 10;

/** Time watched in a slot of a day, and what it was. */
export interface SlotTime {
	day: string;
	/** Where the slot starts, in minutes since midnight. */
	minute: number;
	seconds: number;
	label: string;
}

/** Slots in a row with time, as one stretch: from where the first starts to where the last ends. */
export interface Stretch {
	day: string;
	start: number;
	end: number;
	seconds: number;
	/** Seconds of each thing watched. */
	items: Map<string, number>;
}

/**
 * The stretches in which something was watched, in order: a slot without time between two ends a
 * stretch, so a pause shorter than a slot does not split it, and one longer always does.
 */
export function joinSlots(slots: SlotTime[]): Stretch[] {
	const sorted = [...slots].sort((a, b) => a.day.localeCompare(b.day) || a.minute - b.minute);
	const stretches: Stretch[] = [];
	for (const slot of sorted) {
		let last = stretches.at(-1);
		if (!last || last.day !== slot.day || slot.minute > last.end) {
			last = { day: slot.day, start: slot.minute, end: slot.minute, seconds: 0, items: new Map() };
			stretches.push(last);
		}
		last.end = slot.minute + SLOT_MINUTES;
		last.seconds += slot.seconds;
		last.items.set(slot.label, (last.items.get(slot.label) ?? 0) + slot.seconds);
	}
	return stretches;
}

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

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

/** The first slot that starts after `minute` on the day `daysAhead` from `weekday`. */
function firstStart(slots: Slot[], weekday: number, daysAhead: number, after = -1) {
	const day = (weekday + daysAhead) % 7;
	const starts = slots
		.filter((s) => s.weekday === day && s.startMinute > after)
		.map((s) => s.startMinute);
	return starts.length ? { daysAhead, minute: Math.min(...starts) } : null;
}

/** Whether a child may watch now, having watched `watchedSec` today; and if not, until when. */
export function videoTime(rules: KidRules, watchedSec: number, now: Moment): VideoTime {
	const { slots, dailyMinutes } = rules;
	if (rules.access === 'no') return { allowed: false, reason: 'off', next: null };
	if (rules.access === 'until-tomorrow') {
		// From tomorrow, the schedule again: its first slot, or midnight without one.
		let next: Opening | null = slots.length ? null : { daysAhead: 1, minute: 0 };
		for (let days = 1; !next && days <= 7; days++) next = firstStart(slots, now.weekday, days);
		return { allowed: false, reason: 'off', next };
	}
	const limitReached = dailyMinutes !== null && watchedSec >= dailyMinutes * 60;
	const current = slots.filter(
		(s) => s.weekday === now.weekday && s.startMinute <= now.minute && now.minute < s.endMinute
	);
	const inSchedule = !slots.length || current.length > 0;
	if (inSchedule && !limitReached) {
		return {
			allowed: true,
			until: current.length ? Math.max(...current.map((s) => s.endMinute)) : null
		};
	}

	let next: Opening | null = null;
	if (!slots.length) next = { daysAhead: 1, minute: 0 };
	else {
		// With the limit reached, not today any more.
		if (!limitReached) next = firstStart(slots, now.weekday, 0, now.minute);
		for (let days = 1; !next && days <= 7; days++) next = firstStart(slots, now.weekday, days);
	}
	return { allowed: false, reason: limitReached ? 'limit' : 'schedule', next };
}

/** «hoy a las 17:00», «mañana a las 10:00», «el sábado a las 10:00». */
export function openingText(next: Opening, weekday: number) {
	const at = next.minute === 0 ? '' : ` a las ${clock(next.minute)}`;
	if (next.daysAhead === 0) return `hoy${at}`;
	if (next.daysAhead === 1) return `mañana${at}`;
	return `el ${WEEKDAYS[(weekday + next.daysAhead) % 7]}${at}`;
}

/** Why not now, and when: for the notice and for what the living room refuses. */
export function closedText(time: Extract<VideoTime, { allowed: false }>, weekday: number) {
	const when = time.next ? ` Se puede volver ${openingText(time.next, weekday)}.` : '';
	if (time.reason === 'off') return `Ahora no se pueden ver vídeos.${when}`;
	return time.reason === 'limit'
		? `Por hoy ya se ha acabado el tiempo de ver vídeos.${when}`
		: `Ahora no toca ver vídeos.${when}`;
}
