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

export const trackUrl = (id: number) => `/api/music/track/${id}`;
export const coverUrl = (albumId: number) => `/api/music/cover/${albumId}`;

/** The music on Snapcast: what its mpv is doing. Sent to every open page whenever it changes. */
export interface SnapcastState {
	/** Its mpv is waiting and the app is connected to it. */
	available: boolean;
	/** Something is loaded (playing or paused). */
	active: boolean;
	track: MusicTrack | null;
	paused: boolean;
	positionSec: number | null;
	durationSec: number | null;
	/** From 1. */
	playlistPos: number | null;
	playlistCount: number | null;
}

export type SnapcastAction =
	| { action: 'play'; trackIds: number[]; start: number }
	| { action: 'append'; trackIds: number[] }
	| { action: 'pause'; value: boolean }
	| { action: 'seekTo'; value: number }
	| { action: 'next' }
	| { action: 'previous' }
	| { action: 'stop' };
