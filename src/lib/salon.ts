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
	episodeId: number | null;
	title: string | null;
	/** Above the title, e.g. the series and episode number. */
	subtitle: string | null;
	/** The Cine Club intro is on before the film (`title`); it can be skipped. */
	intro: boolean;
	/** A TV channel (`title`), live: no position to move to. */
	live: boolean;
	/** Where mpv's playlist is, from 1; more than one item with episodes and with the intro. */
	playlistPos: number | null;
	playlistCount: number | null;
	paused: boolean;
	positionSec: number | null;
	durationSec: number | null;
	volume: number | null;
	audioId: number | null;
	subtitleId: number | null;
	tracks: Track[];
	/** What mpv could not open, e.g. «No se pudo abrir La 1»; for a while, or until something plays. */
	failed: string | null;
}

export type RemoteAction =
	| { action: 'pause'; value: boolean }
	| { action: 'seek'; value: number }
	| { action: 'seekTo'; value: number }
	| { action: 'volume'; value: number }
	| { action: 'audio'; value: number }
	| { action: 'subtitle'; value: number | null }
	| { action: 'next' }
	| { action: 'previous' }
	| { action: 'stop' };
