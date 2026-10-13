import { existsSync } from 'node:fs';
import { MUSIC_MPV_SOCKET } from '$app/env/private';
import { log } from '#lib/server/log.ts';
import { MpvClient, StateBroadcast, type MpvMessage } from '#lib/server/mpv-client.ts';
import type { MusicTrack, SnapcastState } from '#lib/music.ts';

/**
 * Music on Snapcast (https://github.com/badaix/snapcast): an mpv left waiting at MUSIC_MPV_SOCKET
 * whose output is the FIFO of snapserver's `pipe` source, as in Snapcast's player setup
 * (doc/player_setup.md). The app queues albums in it and follows what it plays. mpv keeps that
 * output open from one track to the next, so albums play without gaps.
 */

export const snapcastEnabled = Boolean(MUSIC_MPV_SOCKET);

/** Its mpv is there (the optional Snapcast services are running): Snapcast is offered. */
export const snapcastReady = () => snapcastEnabled && existsSync(MUSIC_MPV_SOCKET!);

/** The track of each of mpv's playlist entries. */
const entries = new Map<number, MusicTrack>();
/** The entry playing now. */
let current: number | null = null;

const state: SnapcastState = {
	available: false,
	active: false,
	track: null,
	paused: false,
	positionSec: null,
	durationSec: null,
	playlistPos: null,
	playlistCount: null
};

const pages = new StateBroadcast(state);

const mpv = new MpvClient(
	MUSIC_MPV_SOCKET ?? '',
	['idle-active', 'pause', 'time-pos', 'duration', 'playlist-pos', 'playlist-count'],
	{
		onConnect() {
			state.available = true;
			pages.notify();
		},
		onClose() {
			entries.clear();
			current = null;
			Object.assign(state, { available: false, active: false, track: null });
			pages.notify();
		},
		onProperty(name, data) {
			const number = typeof data === 'number' ? data : null;
			switch (name) {
				case 'idle-active':
					state.active = data === false;
					if (!state.active) Object.assign(state, { track: null, positionSec: null });
					break;
				case 'pause':
					state.paused = data === true;
					break;
				case 'time-pos':
					state.positionSec = number;
					return pages.notify(true);
				case 'duration':
					state.durationSec = number;
					break;
				case 'playlist-pos':
					state.playlistPos = number !== null && number >= 0 ? number + 1 : null;
					break;
				case 'playlist-count':
					state.playlistCount = number;
					break;
			}
			pages.notify();
		},
		onEvent(message: MpvMessage) {
			if (message.event === 'start-file' && message.playlist_entry_id !== undefined) {
				current = message.playlist_entry_id;
				state.track = entries.get(current) ?? null;
				pages.notify();
			}
		}
	},
	'El mpv de la música no está esperando: ¿está arrancado el servicio mpv-music de Snapcast?',
	() => pages.size > 0
);

/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
export function watchSnapcast(listener: (state: SnapcastState) => void) {
	const unwatch = pages.watch(listener);
	mpv.connect().catch(() => mpv.keepTrying());
	return unwatch;
}

/** Adds one track to mpv's playlist; `insert-at` needs mpv 0.38 or later. */
async function load(
	track: MusicTrack,
	path: string,
	how: { flags: 'replace' | 'append-play' } | { flags: 'insert-at'; index: number }
) {
	const result = (await mpv.command({ name: 'loadfile', url: path, ...how })) as {
		playlist_entry_id: number;
	};
	entries.set(result.playlist_entry_id, track);
	// start-file may have arrived before the entry was known.
	if (current === result.playlist_entry_id) {
		state.track = track;
		pages.notify();
	}
}

/**
 * Queues the tracks, each with the path mpv opens it by (MUSIC_DIR is mounted at the same place
 * in its container). `replace`: instead of what was on, starting at `start`, with the ones before
 * it still in the queue to go back to.
 */
export async function queueOnSnapcast(
	tracks: { track: MusicTrack; path: string }[],
	options: { replace: boolean; start?: number }
) {
	if (!tracks.length) return;
	if (!options.replace) {
		// append-play: it starts if nothing was on.
		for (const t of tracks) await load(t.track, t.path, { flags: 'append-play' });
	} else {
		const start = Math.min(Math.max(options.start ?? 0, 0), tracks.length - 1);
		entries.clear();
		// The chosen one first, so that nothing else sounds even for a moment.
		await load(tracks[start].track, tracks[start].path, { flags: 'replace' });
		for (const t of tracks.slice(start + 1)) await load(t.track, t.path, { flags: 'append-play' });
		for (const [i, t] of tracks.slice(0, start).entries())
			await load(t.track, t.path, { flags: 'insert-at', index: i });
	}
	log.info('música', `En Snapcast: ${tracks.length} canciones`, { replace: options.replace });
}

export async function controlSnapcast(
	action:
		| { action: 'pause'; value: boolean }
		| { action: 'seekTo'; value: number }
		| {
				action: 'next' | 'previous' | 'stop';
		  }
) {
	switch (action.action) {
		case 'pause':
			return mpv.command(['set_property', 'pause', action.value]);
		case 'seekTo':
			return mpv.command(['seek', action.value, 'absolute']);
		case 'next':
			return mpv.command(['playlist-next']);
		case 'previous':
			// Like the browser's: past the first seconds, back to the start of the track.
			return (state.positionSec ?? 0) > 3 || state.playlistPos === 1
				? mpv.command(['seek', 0, 'absolute'])
				: mpv.command(['playlist-prev']);
		case 'stop':
			return mpv.command(['stop']);
	}
}
