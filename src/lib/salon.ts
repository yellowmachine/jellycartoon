/** The remote control of the mpv on the host's screen: shared by the server and the pages. */

export interface Track {
	id: number;
	type: 'audio' | 'sub';
	lang: string | null;
	title: string | null;
	forced: boolean;
	channels: number | null;
}

/** What the remote shows. Sent to every open remote whenever it changes. */
export interface RemoteState {
	/** mpv is waiting on the host and the app is connected to it. */
	available: boolean;
	/** Something is loaded (playing or paused). */
	active: boolean;
	movieId: number | null;
	title: string | null;
	paused: boolean;
	positionSec: number | null;
	durationSec: number | null;
	volume: number | null;
	audioId: number | null;
	subtitleId: number | null;
	tracks: Track[];
}

export type RemoteAction =
	| { action: 'pause'; value: boolean }
	| { action: 'seek'; value: number }
	| { action: 'seekTo'; value: number }
	| { action: 'volume'; value: number }
	| { action: 'audio'; value: number }
	| { action: 'subtitle'; value: number | null }
	| { action: 'stop' };
