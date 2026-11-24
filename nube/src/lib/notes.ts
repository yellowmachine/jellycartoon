/** Notes (#416): what the browser and the server both need. Plain, to be tested. */

/** A note's recording at most: dictating, not a podcast. */
export const MAX_NOTE_SECONDS = 300;
/** Enough for 5 minutes of voice at the bitrate asked for, and more if the browser gives more. */
export const MAX_NOTE_BYTES = 8 * 1024 * 1024;
export const MAX_NOTE_TEXT = 4000;
/** It comes already small (shrinkPhoto). */
export const MAX_NOTE_PHOTO_BYTES = 5 * 1024 * 1024;

/** What a recording is, by its first bytes and not by what the browser says; null, none of them. */
export function audioKind(file: Uint8Array) {
	const starts = (bytes: number[], at = 0) => bytes.every((b, i) => file[at + i] === b);
	// WebM on Android, MP4 on iPhone: what MediaRecorder gives.
	if (starts([0x1a, 0x45, 0xdf, 0xa3])) return { ext: 'webm', type: 'audio/webm' };
	if (starts([0x4f, 0x67, 0x67, 0x53])) return { ext: 'ogg', type: 'audio/ogg' };
	if (starts([0x66, 0x74, 0x79, 0x70], 4)) return { ext: 'm4a', type: 'audio/mp4' };
	return null;
}

/** How a kept one is served, by its name. */
export const audioTypeOf = (name: string) =>
	name.endsWith('.webm')
		? 'audio/webm'
		: name.endsWith('.ogg')
			? 'audio/ogg'
			: name.endsWith('.m4a')
				? 'audio/mp4'
				: null;

/** A note as a page shows it. */
export interface Note {
	id: number;
	at: Date;
	text: string;
	hearing: 'ready' | 'pending' | 'failed';
	hasAudio: boolean;
	/** Where its photo is served from; null, none. */
	photo: string | null;
	source: 'pagina' | 'paseo' | 'voz' | 'escrita';
	mine: boolean;
	/** Seen by the whole house: theirs who shared it, or, without a person, the house's own. */
	shared: boolean;
	/** Whose, when not one's own: null, the house's (said to a satellite). */
	author: string | null;
	/** One's own, or the house's: what another shares is only to look at. */
	canEdit: boolean;
	lon: number | null;
	lat: number | null;
}
