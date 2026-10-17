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
	| { kind: 'control'; action: VoiceControl };

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

export interface VoiceRequest {
	text: string;
	/** What sounds on this device now, as the page shows it; null if nothing. */
	here: string | null;
	history: VoiceTurn[];
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
	return { text: said, here: text(b.here, 200), history: history.slice(-HISTORY_TURNS) };
}
