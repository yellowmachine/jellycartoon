import type { RadioStream } from '#lib/radio.ts';

/** Music, shared by the server and the pages. */

export interface MusicTrack {
	id: number;
	title: string;
	/** The track's own; the album's when it has none. */
	artist: string;
	number: number | null;
	durationSec: number | null;
	albumId: number;
	album: string;
	hasCover: boolean;
}

export interface MusicAlbum {
	id: number;
	title: string;
	artist: string;
	hasCover: boolean;
	tracks: MusicTrack[];
}

/** Accents and case do not matter: «heroes» finds «Héroes del Silencio». */
export function fold(text: string) {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export interface MusicArtist {
	name: string;
	albums: MusicAlbum[];
}

/** The albums by album artist, in the order they come; «AC/DC» and «Ac/Dc» are one artist. */
export function groupByArtist(albums: MusicAlbum[]): MusicArtist[] {
	const artists = new Map<string, MusicArtist>();
	for (const a of albums) {
		const key = fold(a.artist);
		const artist = artists.get(key);
		if (artist) artist.albums.push(a);
		else artists.set(key, { name: a.artist, albums: [a] });
	}
	return [...artists.values()];
}

export const artistUrl = (name: string) => `/musica/artista/${encodeURIComponent(name)}`;
/** With `opus`, its copy for mobile data (#64), or the FLAC while it is not made. */
export const trackUrl = (id: number, opus = false) =>
	`/api/music/track/${id}${opus ? '?format=opus' : ''}`;
export const coverUrl = (albumId: number) => `/api/music/cover/${albumId}`;

/** A Snapcast client: a speaker somewhere in the house. */
export interface Speaker {
	id: string;
	/** Its name in Snapcast, or the host's if it has none. */
	name: string;
	hostName: string;
	connected: boolean;
	/** 0–100. */
	volume: number;
	muted: boolean;
	/** Its Snapcast group, which can be muted as a whole. */
	groupId: string;
	groupMuted: boolean;
}

/** What the master volume moves: the speakers that are on, as Snapweb's group slider. */
export const masterSpeakers = (speakers: Speaker[]) => speakers.filter((s) => s.connected);

/** The master volume as Snapweb shows it: the average of its speakers. */
export function masterVolume(speakers: Speaker[]) {
	const on = masterSpeakers(speakers);
	return on.length ? Math.round(on.reduce((sum, s) => sum + s.volume, 0) / on.length) : 0;
}

/**
 * Each speaker's volume for a master volume of `value`, as Snapweb does it: down, all lose the
 * same share of what they have; up, the same share of what they lack. So they keep their balance,
 * and 0 or 100 takes them all there.
 */
export function scaleVolumes(speakers: Speaker[], value: number) {
	const on = masterSpeakers(speakers);
	const from = on.reduce((sum, s) => sum + s.volume, 0) / on.length;
	const ratio =
		value < from ? (from - value) / from : value > from ? (value - from) / (100 - from) : 0;
	return on.map((s) => ({
		id: s.id,
		volume: Math.round(
			value < from ? s.volume - ratio * s.volume : s.volume + ratio * (100 - s.volume)
		)
	}));
}

/** The music on Snapcast: what its mpv is doing. Sent to every open page whenever it changes. */
export interface SnapcastState {
	/** Its mpv is waiting and the app is connected to it. */
	available: boolean;
	/** Something is loaded (playing or paused). */
	active: boolean;
	track: MusicTrack | null;
	/** A station instead of a track. */
	radio: RadioStream | null;
	/** What the station says is on now (its ICY title), when it says so. */
	nowPlaying: string | null;
	paused: boolean;
	positionSec: number | null;
	durationSec: number | null;
	/** From 1. */
	playlistPos: number | null;
	playlistCount: number | null;
	/** The queue in random order. */
	shuffle: boolean;
	/** At the end, back to the start: of the queue, or of the track with `single`. */
	repeat: boolean;
	/** Only the track that is on: it stops at its end, or starts again with `repeat`. */
	single: boolean;
	/** Snapserver's clients, connected or not; null while its control API cannot be reached. */
	speakers: Speaker[] | null;
}

export type SnapcastAction =
	| { action: 'play'; trackIds: number[]; start: number }
	| { action: 'append'; trackIds: number[] }
	| { action: 'radio'; uuid: string }
	| { action: 'pause'; value: boolean }
	| { action: 'seekTo'; value: number }
	| { action: 'next' }
	| { action: 'previous' }
	| { action: 'stop' }
	| { action: 'shuffle'; value: boolean }
	| { action: 'repeat'; value: boolean }
	| { action: 'single'; value: boolean }
	| { action: 'volume'; speakerId: string; value: number }
	| { action: 'mute'; speakerId: string; value: boolean }
	| { action: 'masterVolume'; value: number }
	| { action: 'masterMute'; value: boolean }
	| { action: 'rename'; speakerId: string; name: string };

/** What a browser saves of what it plays (music_queue), to go on with it on any device. */
export interface QueueSave {
	/** In the order they sound. */
	trackIds: number[];
	index: number;
	positionSec: number;
	shuffle: boolean;
	repeat: boolean;
	single: boolean;
	/** A station instead of the tracks. */
	radio: string | null;
	/** A podcast episode instead of the tracks. */
	podcast: number | null;
	/** Where it was saved from, as it is shown: «la TV», «el móvil». */
	changedBy: string;
}

/** The saved queue, as the page gets it back: the tracks that are still there. */
export interface SavedQueue extends Omit<QueueSave, 'trackIds'> {
	tracks: MusicTrack[];
	updatedAt: string;
}

/** A save from a page, only if it is well formed; the index within the queue. */
export function parseQueueSave(body: unknown): QueueSave | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const { trackIds, index, positionSec, radio, changedBy } = b;
	const podcast = b.podcast ?? null;
	if (!Array.isArray(trackIds) || trackIds.length > 5000) return null;
	if (!trackIds.every((id) => Number.isInteger(id))) return null;
	if (!Number.isInteger(index) || typeof positionSec !== 'number' || !Number.isFinite(positionSec))
		return null;
	if (radio !== null && typeof radio !== 'string') return null;
	if (podcast !== null && !Number.isInteger(podcast)) return null;
	if (!trackIds.length && radio === null && podcast === null) return null;
	if (typeof changedBy !== 'string' || !changedBy.trim()) return null;
	return {
		trackIds,
		index: trackIds.length ? Math.min(Math.max(index as number, 0), trackIds.length - 1) : 0,
		positionSec: Math.max(positionSec, 0),
		shuffle: b.shuffle === true,
		repeat: b.repeat === true,
		single: b.single === true,
		radio,
		podcast: podcast as number | null,
		changedBy: changedBy.trim().slice(0, 50)
	};
}
