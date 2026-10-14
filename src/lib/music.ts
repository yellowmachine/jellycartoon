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
export const trackUrl = (id: number) => `/api/music/track/${id}`;
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
	| { action: 'rename'; speakerId: string; name: string };
