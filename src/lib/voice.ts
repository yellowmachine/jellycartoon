import type { MusicTrack } from '#lib/music.ts';

/** Voice commands (#33), shared by the server and /voz. */

/**
 * Where something sounds: this device (the browser that was spoken to) or the whole house
 * (Snapcast). The living room (the host's mpv) comes later.
 */
export type VoiceTarget = 'here' | 'house';

export type VoiceControl = 'pause' | 'resume' | 'next' | 'previous' | 'stop';

/** What the device has to do itself: the server cannot play in its browser. */
export type VoiceAction =
	| { kind: 'play'; tracks: MusicTrack[]; start: number; shuffle: boolean }
	| { kind: 'radio'; uuid: string }
	| { kind: 'control'; action: VoiceControl }
	/** An episode in this browser's player; `startSec` null: from where it was left. */
	| { kind: 'watch'; episodeId: number; startSec: number | null }
	/** A kitchen timer in this browser (#60); one with the same name starts over. */
	| { kind: 'timer'; label: string; seconds: number }
	/** Waiting for something to be said («cuando hierva»): it is started by voice or a tap. */
	| { kind: 'prepareTimer'; label: string; seconds: number; trigger: string }
	/** The screen stays on in this browser (the phone on the kitchen wall), or no longer. */
	| { kind: 'kitchenMode'; on: boolean }
	/** That one by its name, or all of them with null. */
	| { kind: 'cancelTimer'; label: string | null };

/** The longest timer: a day. */
export const MAX_TIMER_SEC = 24 * 3600;

/** A choice when the order was not clear: tapped, its `command` is sent as if it had been said. */
export interface VoiceOption {
	label: string;
	command: string;
}

/** A turn of the conversation before, so that «no, eso no» means something. */
export interface VoiceTurn {
	role: 'user' | 'assistant';
	content: string;
}

/** The episode playing in this browser's player, and where: what «los últimos 5 minutos» are of. */
export interface VideoHere {
	episodeId: number;
	positionSec: number;
}

export interface VoiceRequest {
	text: string;
	/** What sounds on this device now, as the page shows it; null if nothing. */
	here: string | null;
	video: VideoHere | null;
	history: VoiceTurn[];
	/**
	 * This browser's timers, as it says them: «la pasta, quedan 7 min 5 s», or prepared, «el
	 * arroz, 30 min, preparado: arranca cuando esté hecho el sofrito».
	 */
	timers: string[];
}

export interface VoiceReply {
	/** Short, to be read aloud. */
	reply: string;
	actions: VoiceAction[];
	options: VoiceOption[];
}

/** The turns before that are kept: the last exchanges are enough. */
export const HISTORY_TURNS = 6;

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** A command from a page, only if it is well formed; the history, the last turns and valid ones. */
export function parseVoiceRequest(body: unknown): VoiceRequest | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const said = text(b.text, 500);
	if (!said) return null;
	const history = (Array.isArray(b.history) ? b.history : []).flatMap((turn: unknown) => {
		const t = turn as Record<string, unknown> | null;
		const content = text(t?.content, 500);
		return (t?.role === 'user' || t?.role === 'assistant') && content
			? [{ role: t.role, content } as VoiceTurn]
			: [];
	});
	const v = b.video as Record<string, unknown> | null | undefined;
	const video =
		v &&
		Number.isInteger(v.episodeId) &&
		Number.isFinite(v.positionSec) &&
		Number(v.positionSec) >= 0
			? { episodeId: Number(v.episodeId), positionSec: Number(v.positionSec) }
			: null;
	return {
		text: said,
		here: text(b.here, 200),
		video,
		history: history.slice(-HISTORY_TURNS),
		timers: (Array.isArray(b.timers) ? b.timers : [])
			.flatMap((t: unknown) => text(t, 100) ?? [])
			.slice(0, 20)
	};
}
