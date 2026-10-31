import type { RadioStream } from './radio.ts';

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
	/** Not a song: what the DJ says between them (Modo DJ), in the queue as one more. */
	clip?: { id: string; text: string };
	/** Not the library's: its own address (Seilide's Oración, #339), with no album to go to. */
	src?: string;
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
/**
 * Where the tracks, the covers and the DJ's words are: jellycartoon's own API by default; the cloud
 * (#253) gives its own (the house's, by a signed pass) with `setMusicUrls`, once, before playing.
 */
export interface MusicUrls {
	/** With `opus`, its copy for mobile data (#64), or the FLAC while it is not made. */
	track: (id: number, opus: boolean) => string;
	cover: (albumId: number) => string;
	clip: (id: string) => string;
}

const urls: MusicUrls = {
	track: (id, opus) => `/api/music/track/${id}${opus ? '?format=opus' : ''}`,
	cover: (albumId) => `/api/music/cover/${albumId}`,
	clip: (id) => `/api/music/dj/${id}`
};

export function setMusicUrls(own: Partial<MusicUrls>) {
	Object.assign(urls, own);
}

export const trackUrl = (id: number, opus = false) => urls.track(id, opus);
export const coverUrl = (albumId: number) => urls.cover(albumId);
/** What `track` sounds from: its own address, the DJ's words, or its file. */
export const audioUrl = (track: MusicTrack, opus = false) =>
	track.src ?? (track.clip ? urls.clip(track.clip.id) : trackUrl(track.id, opus));

/** Modo DJ: songs at random, and the DJ speaking every few. */
export interface DjOptions {
	/** Only these album artists; none, the whole library. */
	artists: string[];
	lang: 'es' | 'en';
	/** Songs between one talk and the next. */
	every: number;
	/** The DJ's voice, a man's or a woman's (OpenRouter's; Piper has only its own). */
	voice: DjVoice;
}

export type DjVoice = 'male' | 'female';
/** For setups saved before there was a choice. */
export const DJ_DEFAULT_VOICE: DjVoice = 'male';
export const isDjVoice = (v: unknown): v is DjVoice => v === 'male' || v === 'female';

/** A Modo DJ setup saved with a name, to start it again. */
export interface DjPreset {
	id: number;
	name: string;
	options: DjOptions;
}

export const DJ_EVERY = { min: 1, max: 8, default: 3 };

/** Options from a page, only if well formed. */
export function parseDjOptions(body: unknown): DjOptions | null {
	if (!body || typeof body !== 'object') return null;
	const { artists, lang, every, voice = DJ_DEFAULT_VOICE } = body as Record<string, unknown>;
	if (!Array.isArray(artists) || artists.length > 500) return null;
	if (!artists.every((a) => typeof a === 'string')) return null;
	if (lang !== 'es' && lang !== 'en') return null;
	if (
		!Number.isInteger(every) ||
		(every as number) < DJ_EVERY.min ||
		(every as number) > DJ_EVERY.max
	)
		return null;
	if (!isDjVoice(voice)) return null;
	return { artists: artists as string[], lang, every: every as number, voice };
}

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

/** An episode only listened to on Snapcast: its audio, as a song (#223, snapcast.ts). */
export interface SnapcastEpisode {
	id: number;
	/** «El de la boda». */
	title: string;
	/** «Friends · T1 E2». */
	subtitle: string;
	seriesId: number;
	durationSec: number | null;
}

/** Where on Snapcast: every speaker, or only one (its id) and the rest of its group. */
export type SnapcastWhere = 'house' | { speakerId: string };

/**
 * What Seilide sends the house's Snapcast that is not the house's (#339, Oración): its own
 * addresses, with a pass in them for mpv, and the pauses between them, played by mpv itself.
 */
export type SnapcastRemoteItem =
	{ title: string; src: string; durationSec: number | null } | { pauseSec: number };

export interface SnapcastRemote {
	/** Where it comes from and what it is, as the queue shows them: «Oración», «Rosario». */
	artist: string;
	album: string;
	items: SnapcastRemoteItem[];
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
	/** An episode's audio instead of a track. */
	episode: SnapcastEpisode | null;
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
	/** In Modo DJ: songs at random, and the DJ between them. */
	dj: boolean;
	/** «Para al acabar esta canción» (the voice): it stops at the end of the track that is on. */
	stopAfterTrack: boolean;
	/** «Para dentro de media hora»: when (Date.now()), then at the end of the song on; or null. */
	stopAt: number | null;
}

export type SnapcastAction =
	| { action: 'play'; trackIds: number[]; start: number }
	| { action: 'append'; trackIds: number[] }
	| { action: 'radio'; uuid: string }
	| { action: 'episode'; episodeId: number; startSec: number | null; where: SnapcastWhere }
	| { action: 'pause'; value: boolean }
	| { action: 'seekTo'; value: number }
	| { action: 'next' }
	| { action: 'previous' }
	| { action: 'stop' }
	| { action: 'shuffle'; value: boolean }
	| { action: 'repeat'; value: boolean }
	| { action: 'single'; value: boolean }
	/** «Para al acabar esta canción»; false, no longer. */
	| { action: 'stopAfterTrack'; value: boolean }
	/** «Para dentro de media hora», at the end of the song on then; 0, no longer. */
	| { action: 'stopIn'; minutes: number }
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

/** The bars' notice of «para dentro de media hora»: «a las 23:30». */
export const stopTime = (at: number) =>
	`a las ${new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
