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
	/** A web saved to read later (#634): its address; null, an ordinary note. */
	link: string | null;
	/** Of that web's article, when it could be read: to say it before opening it. */
	article: { minutes: number; site: string | null } | null;
	tags: string[];
}

/** When a photo says it was taken, if it makes sense: not to come, nor before there were any. */
export function photoMoment(ms: number, now = Date.now()) {
	return Number.isFinite(ms) && ms > Date.UTC(1990, 0, 1) && ms <= now + 5 * 60_000
		? new Date(ms)
		: null;
}

/** A walk's photo as Notas shows it (#613). */
export interface WalkPhotoItem {
	id: number;
	/** Null, its walk was deleted. */
	walkId: number | null;
	at: Date;
}

/** What Notas lists: a note, or a walk's photos together (those of deleted walks, by day). */
export type NotesItem =
	| { key: string; at: Date; note: Note }
	| { key: string; at: Date; walkId: number | null; photos: WalkPhotoItem[] };

/**
 * Notes and walks' photos, the latest first; each group where its latest photo is. With the notes cut
 * at `limit`, photos older than the last one shown wait too: there would be notes between.
 */
export function notesAndPhotos(
	notes: Note[],
	photos: WalkPhotoItem[],
	dayOf: (d: Date) => string,
	limit = 200
): NotesItem[] {
	const oldest = notes.length >= limit ? new Date(notes.at(-1)!.at).getTime() : -Infinity;
	const groups = new Map<string, WalkPhotoItem[]>();
	for (const p of photos) {
		if (new Date(p.at).getTime() < oldest) continue;
		const key = p.walkId === null ? `dia-${dayOf(new Date(p.at))}` : `paseo-${p.walkId}`;
		groups.set(key, [...(groups.get(key) ?? []), p]);
	}
	const items: NotesItem[] = [
		...notes.map((n) => ({ key: `nota-${n.id}`, at: new Date(n.at), note: n })),
		...[...groups].map(([key, list]) => ({
			key,
			at: new Date(Math.max(...list.map((p) => new Date(p.at).getTime()))),
			walkId: list[0]!.walkId,
			photos: list.toSorted((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
		}))
	];
	return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * A web saved to read later (#634): its article, cleaned (Readability) and sanitized, without
 * pictures; only to read. Its `text`, for the search.
 */
export interface NoteArticle {
	title: string;
	byline: string | null;
	site: string | null;
	html: string;
	text: string;
	/** To read it, at about 220 words a minute. */
	minutes: number;
}

/** Tags of a note, at most; and each, at most this long. */
export const MAX_NOTE_TAGS = 10;
export const MAX_TAG = 30;

/**
 * Tags as written, «Cocina, niños»: each lowercase and trimmed, without a leading #, once each, in
 * the order given.
 */
export function parseTags(written: string) {
	const seen = new Set<string>();
	for (const raw of written.split(/[,\n]/)) {
		const tag = raw
			.trim()
			.replace(/^#+/, '')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase()
			.slice(0, MAX_TAG);
		if (tag) seen.add(tag);
	}
	return [...seen].slice(0, MAX_NOTE_TAGS);
}
