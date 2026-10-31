import type { MusicTrack, SnapcastRemote } from 'comun/music.ts';

/**
 * Oración (#339), as the pages and the server both see it: a text's state, a list as the player's
 * queue, and a long text cut into what Gemini reads at a time.
 */

export const MAX_TITLE = 80;
export const MAX_TEXT = 20_000;
export const MAX_VOICE_NAME = 40;
export const MAX_ITEMS = 100;
export const MAX_TIMES = 50;
export const MAX_PAUSE = 30;
/** A voice tried (#339): a few lines, enough to hear it; a text longer than `LONG_TEXT`, try first. */
export const MAX_TRY = 300;
export const LONG_TEXT = 600;
export const TRY_SAMPLE = 'Dios te salve, María, llena eres de gracia, el Señor es contigo.';

/** What is tried of a text: its first lines, up to `MAX_TRY`. */
export const tryPiece = (text: string) => speechChunks(text, MAX_TRY)[0]?.slice(0, MAX_TRY) ?? '';

/**
 * `cambiada`: recorded, but its text or its voice changed since; the old recording still plays.
 * `generando` for longer than this is a recording the server lost (a restart): `error`.
 */
export type PrayerStatus = 'pendiente' | 'generando' | 'lista' | 'cambiada' | 'error';
export const GENERATING_MS = 15 * 60_000;

export const STATUS_LABEL: Record<PrayerStatus, string> = {
	pendiente: 'Sin voz',
	generando: 'Generando la voz…',
	lista: 'Con voz',
	cambiada: 'Ha cambiado: regenerar',
	error: 'No se pudo generar'
};

export interface PrayerVoiceView {
	id: number;
	name: string;
	voice: string;
	tone: string;
	/** How many texts use it: one in use is not deleted. */
	uses: number;
}

export interface PrayerView {
	id: number;
	title: string;
	text: string;
	voiceId: number;
	status: PrayerStatus;
	durationSec: number | null;
	error: string | null;
	/** Where its recording is (the one there, even if `cambiada`); null, none. */
	audioUrl: string | null;
	/** What it was recorded with (prayers.ts, `recordingKey`); null, never recorded. */
	audioKey: string | null;
}

export interface PrayerListView {
	id: number;
	title: string;
	pauseSec: number;
	items: { prayerId: number; times: number }[];
}

/** What the whole house plays of Oración (#339, Snapcast), as the page shows it. */
export interface HouseNow {
	title: string;
	album: string;
	paused: boolean;
	positionSec: number | null;
	durationSec: number | null;
	/** The last of the list: nothing after it. */
	last: boolean;
}

/** Its recording's address: by what it was recorded with, as the browser keeps it a day. */
export const prayerAudioUrl = (id: number, audioKey: string) =>
	`/api/oracion/audio/${id}?v=${audioKey}`;

export const silenceUrl = (sec: number) => `/api/oracion/silencio/${sec}`;

/**
 * A list as the player's queue: each text its `times` (with «2/10» in its title), and the pause as
 * silence between them. Texts without a recording are left out, and counted.
 */
export function prayerQueue(list: PrayerListView, prayers: PrayerView[]) {
	const byId = new Map(prayers.map((p) => [p.id, p]));
	const tracks: MusicTrack[] = [];
	let missing = 0;
	const track = (title: string, src: string, durationSec: number | null): MusicTrack => ({
		// Not the library's: negative, and one each, as the queue tells them apart by it.
		id: -(tracks.length + 1),
		title,
		artist: 'Oración',
		album: list.title,
		number: null,
		durationSec,
		albumId: 0,
		hasCover: false,
		src
	});
	for (const item of list.items) {
		const p = byId.get(item.prayerId);
		if (!p?.audioUrl) {
			missing++;
			continue;
		}
		for (let i = 1; i <= item.times; i++) {
			if (tracks.length && list.pauseSec > 0)
				tracks.push(track('Pausa', silenceUrl(list.pauseSec), list.pauseSec));
			tracks.push(
				track(
					item.times > 1 ? `${p.title} (${i}/${item.times})` : p.title,
					p.audioUrl,
					p.durationSec
				)
			);
		}
	}
	return { tracks, missing };
}

/**
 * A list as the house's Snapcast plays it (#339): the same order as `prayerQueue`, with the house's
 * addresses for each recording (`urlOf`, with a pass in them) and the pauses for mpv to make.
 */
export function prayerRemote(
	list: PrayerListView,
	prayers: PrayerView[],
	urlOf: (id: number, audioKey: string) => string
) {
	const byId = new Map(prayers.map((p) => [p.id, p]));
	const items: SnapcastRemote['items'] = [];
	let missing = 0;
	for (const item of list.items) {
		const p = byId.get(item.prayerId);
		if (!p?.audioKey) {
			missing++;
			continue;
		}
		for (let i = 1; i <= item.times; i++) {
			if (items.length && list.pauseSec > 0) items.push({ pauseSec: list.pauseSec });
			items.push({
				title: item.times > 1 ? `${p.title} (${i}/${item.times})` : p.title,
				src: urlOf(p.id, p.audioKey),
				durationSec: p.durationSec
			});
		}
	}
	const remote: SnapcastRemote = { artist: 'Oración', album: list.title, items };
	return { remote, missing };
}

/** What Gemini reads at a time, at most: a litany is longer than it reads well in one go. */
export const CHUNK_CHARS = 1200;

/**
 * A text in pieces of whole lines (a litany's invocations stay whole), each up to `max`; a line
 * longer than that, by its sentences.
 */
export function speechChunks(text: string, max = CHUNK_CHARS) {
	const pieces = text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.flatMap((line) =>
			line.length <= max
				? [line]
				: (line.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [line]).map((s) => s.trim())
		);
	const chunks: string[] = [];
	let current = '';
	for (const piece of pieces) {
		const joined = current ? `${current}\n${piece}` : piece;
		if (joined.length > max && current.trim()) {
			chunks.push(current.trim());
			current = piece;
		} else current = joined;
	}
	if (current.trim()) chunks.push(current.trim());
	// A sentence longer than `max` on its own goes as it is.
	return chunks;
}
