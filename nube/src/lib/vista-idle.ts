import { inQuietHours, type QuietHours } from '#lib/quiet-hours.ts';

/**
 * When the Vista (#525) rests, when it comes back by itself, and when it is night: pure, for the
 * tests. The Vista screen (vista.svelte.ts) asks every few seconds.
 */

/** In the Vista this long untouched, the resting screen: the clock, the weather, today. */
export const REST_MS = 2 * 60_000;
/** At night it rests sooner: a lit screen in the dark living room bothers. */
export const REST_NIGHT_MS = 60_000;
/** The family's «Horas de silencio», or without them these: the house asleep. */
export const DEFAULT_NIGHT: QuietHours = { from: '23:00', to: '07:00' };
/** «Pantalla de casa»: out of the Vista this long untouched, back to it. */
export const BACK_MS = 5 * 60_000;

export interface IdleState {
	/** Since the last touch or key on the page. */
	idleMs: number;
	/** A video with sound playing here: someone watches it. */
	videoPlaying: boolean;
	/** The voice listens, thinks or answers. */
	voiceBusy: boolean;
	/** A timer or an alarm rings: «Parar» must be there. */
	ringing: boolean;
}

const busy = (s: IdleState) => s.videoPlaying || s.voiceBusy || s.ringing;

/** In the Vista: whether it rests now (sooner at night). */
export const shouldRest = (s: IdleState, night = false) =>
	!busy(s) && s.idleMs >= (night ? REST_NIGHT_MS : REST_MS);

/** Out of the Vista on a «pantalla de casa»: whether it goes back to it now. */
export const shouldGoBack = (s: IdleState) => !busy(s) && s.idleMs >= BACK_MS;

/** Whether it is night now, by the family's «Horas de silencio» (or DEFAULT_NIGHT). */
export const isNight = (hours: QuietHours | null, now: Date) =>
	inQuietHours(hours ?? DEFAULT_NIGHT, now.getHours() * 60 + now.getMinutes());
