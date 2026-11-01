import type { MusicTrack } from 'comun/music.ts';

/**
 * Music without coverage (#350): the house's playlists carried on a device, such as the car's
 * tablet, the same devices as the routes' maps (#164). What the server and the pages share; the
 * work itself, music-offline.ts on the server and offline-music.svelte.ts on the device.
 */

/** At most this much on a device: some 500 songs in Opus. */
export const MAX_OFFLINE_BYTES = 2_000_000_000;

/**
 * Bytes a second of the house's Opus copies (160 kbit/s, toOpus in jellycartoon): to tell before
 * ordering whether a list fits. On the device, each song's real size.
 */
export const OPUS_BYTES_PER_SEC = 20_000;

/** Lists of these lengths (seconds), in Opus: about what they take. */
export const estimatedBytes = (lengths: number[]) =>
	lengths.reduce((sum, sec) => sum + sec, 0) * OPUS_BYTES_PER_SEC;

/** What the device is told to keep, in order: the first ordered first, if not all fit. */
export interface OfflineListOrder {
	id: number;
	name: string;
	tracks: MusicTrack[];
}

/** What the device says of one list. */
export interface OfflineListReport {
	playlistId: number;
	state: 'downloading' | 'ready' | 'failed';
	held: number;
	total: number;
	bytes: number;
	problem?: string;
}

export interface OfflineListsView {
	devices: { id: string; name: string; lastSeenAt: Date }[];
	lists: {
		playlistId: number;
		deviceId: string;
		name: string;
		state: 'pending' | 'downloading' | 'ready' | 'failed';
		held: number;
		total: number;
		bytes: number;
		problem: string | null;
		updatedAt: Date;
	}[];
}

/** «No cabe»: what it would take, in the same words for the panel and the device. */
export const noRoomText = 'No cabe: pasaría de 2 GB en el dispositivo';
