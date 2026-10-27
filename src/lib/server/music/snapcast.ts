import { existsSync } from 'node:fs';
import { MUSIC_MPV_SOCKET, SNAPSERVER_CONTROL } from '$app/env/private';
import { inOrder } from '#lib/server/in-order.ts';
import { log } from '#lib/server/log.ts';
import { MpvClient, StateBroadcast, type MpvMessage } from '#lib/server/mpv-client.ts';
import type { MusicTrack, SnapcastAction, SnapcastState } from '#lib/music.ts';
import type { RadioStream } from '#lib/radio.ts';
import { SnapserverControl } from './snapserver.ts';

/**
 * Music on Snapcast (https://github.com/badaix/snapcast): an mpv left waiting at MUSIC_MPV_SOCKET
 * whose output is the FIFO of snapserver's `pipe` source, as in Snapcast's player setup
 * (doc/player_setup.md). The app queues albums in it, or opens a radio station, and follows what
 * it plays. mpv keeps that output open from one track to the next, so albums play without gaps.
 */

export const snapcastEnabled = Boolean(MUSIC_MPV_SOCKET);

/** Its mpv is there (the optional Snapcast services are running): Snapcast is offered. */
export const snapcastReady = () => snapcastEnabled && existsSync(MUSIC_MPV_SOCKET!);

/** What each of mpv's playlist entries is: a track, or a station. */
type Entry = { track: MusicTrack } | { radio: RadioStream };
const entries = new Map<number, Entry>();
/** The entry playing now. */
let current: number | null = null;
/** Stopped at the end of a track, with `single`. */
let eofReached = false;

const state: SnapcastState = {
	available: false,
	active: false,
	track: null,
	radio: null,
	nowPlaying: null,
	paused: false,
	positionSec: null,
	durationSec: null,
	playlistPos: null,
	playlistCount: null,
	shuffle: false,
	repeat: false,
	single: false,
	speakers: null,
	dj: false
};

/** Told the entry that starts, once it is known: Modo DJ follows the queue with it. */
type StartListener = (entryId: number, track: MusicTrack) => void;
const startListeners = new Set<StartListener>();

export function onSnapcastTrack(listener: StartListener) {
	startListeners.add(listener);
	return () => startListeners.delete(listener);
}

function started(entryId: number, entry: Entry | undefined) {
	if (!entry || !('track' in entry)) return;
	for (const listener of startListeners) listener(entryId, entry.track);
}

const pages = new StateBroadcast(state);

/** What the remotes show of the entry now playing. */
function show(entry: Entry | undefined) {
	Object.assign(state, {
		track: entry && 'track' in entry ? entry.track : null,
		radio: entry && 'radio' in entry ? entry.radio : null,
		nowPlaying: null
	});
	pages.notify();
}

/** The speakers: only with SNAPSERVER_CONTROL. */
const control = SNAPSERVER_CONTROL
	? new SnapserverControl(
			SNAPSERVER_CONTROL,
			(speakers) => {
				state.speakers = speakers;
				pages.notify();
			},
			() => pages.size > 0
		)
	: null;

const mpv = new MpvClient(
	MUSIC_MPV_SOCKET ?? '',
	[
		'idle-active',
		'pause',
		'time-pos',
		'duration',
		'playlist-pos',
		'playlist-count',
		// The modes, as mpv has them: shuffle is only remembered there (playlist-shuffle does it).
		'shuffle',
		'loop-playlist',
		'keep-open',
		'eof-reached',
		// What many stations say is on (Icecast/Shoutcast's StreamTitle): the song or the programme.
		'metadata/by-key/icy-title'
	],
	{
		onConnect() {
			state.available = true;
			pages.notify();
		},
		onClose() {
			entries.clear();
			current = null;
			Object.assign(state, {
				available: false,
				active: false,
				track: null,
				radio: null,
				nowPlaying: null
			});
			pages.notify();
		},
		onProperty(name, data) {
			const number = typeof data === 'number' ? data : null;
			switch (name) {
				case 'idle-active':
					state.active = data === false;
					if (!state.active)
						Object.assign(state, { track: null, radio: null, nowPlaying: null, positionSec: null });
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
				case 'shuffle':
					state.shuffle = data === true;
					break;
				// false or "no" when off, "inf" or a number of times when on.
				case 'loop-playlist':
					state.repeat = data !== false && data !== 'no';
					break;
				case 'keep-open':
					state.single = data === 'always';
					break;
				case 'eof-reached':
					eofReached = data === true;
					return;
				case 'metadata/by-key/icy-title':
					state.nowPlaying = typeof data === 'string' && data.trim() ? data.trim() : null;
					break;
			}
			pages.notify();
		},
		onEvent(message: MpvMessage) {
			if (message.event === 'start-file' && message.playlist_entry_id !== undefined) {
				current = message.playlist_entry_id;
				show(entries.get(current));
				started(current, entries.get(current));
			}
		}
	},
	'El mpv de la música no está esperando: ¿está arrancado el servicio mpv-music de Snapcast?',
	() => pages.size > 0
);

/**
 * What Snapcast is doing now, as last known: live while a page watches it (the Snapcast bar of
 * every page does).
 */
export const snapcastNow = (): SnapcastState => structuredClone(state);

/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
export function watchSnapcast(listener: (state: SnapcastState) => void) {
	const unwatch = pages.watch(listener);
	mpv.connect().catch(() => mpv.keepTrying());
	control?.connect().catch(() => control.keepTrying());
	return unwatch;
}

/** Adds a track or a station to mpv's playlist; `insert-at` needs mpv 0.38 or later. */
async function loadEntry(
	entry: Entry,
	url: string,
	how: { flags: 'replace' | 'append-play' } | { flags: 'insert-at'; index: number }
) {
	const result = (await mpv.command({ name: 'loadfile', url, ...how })) as {
		playlist_entry_id: number;
	};
	entries.set(result.playlist_entry_id, entry);
	// start-file may have arrived before the entry was known.
	if (current === result.playlist_entry_id) {
		show(entry);
		started(current, entry);
	}
}

const load = (track: MusicTrack, path: string, how: Parameters<typeof loadEntry>[2]) =>
	loadEntry({ track }, path, how);

/**
 * A station, instead of whatever was on. mpv opens its stream as it is, HLS too; the container
 * needs the network for it.
 */
export async function radioOnSnapcast(stream: RadioStream) {
	entries.clear();
	await loadEntry({ radio: stream }, stream.url, { flags: 'replace' });
	log.info('música', `En Snapcast: ${stream.name}`, { url: stream.url });
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
		if (state.shuffle) await shuffleQueue();
	}
	log.info('música', `En Snapcast: ${tracks.length} canciones`, { replace: options.replace });
}

/** Right after the one that is on (the DJ's words); at the end if nothing is. */
export async function insertNextOnSnapcast(track: MusicTrack, path: string) {
	// playlistPos counts from 1: as an index, it is the one after.
	if (state.playlistPos === null) return load(track, path, { flags: 'append-play' });
	await load(track, path, { flags: 'insert-at', index: state.playlistPos });
}

/** The song after the one that is on, if it is one. */
export async function nextOnSnapcast() {
	if (state.playlistPos === null) return null;
	const id = await mpv
		.command(['get_property', `playlist/${state.playlistPos}/id`])
		.catch(() => null);
	const entry = typeof id === 'number' ? entries.get(id) : undefined;
	return entry && 'track' in entry ? entry.track : null;
}

/**
 * Entries after the one that is on, asked to mpv: what the app last heard may be from before the
 * queue it has just been sent.
 */
export async function snapcastRemaining() {
	const [pos, count] = await Promise.all([
		mpv.command(['get_property', 'playlist-pos']),
		mpv.command(['get_property', 'playlist-count'])
	]);
	return typeof pos === 'number' && typeof count === 'number' && pos >= 0 ? count - pos - 1 : 0;
}

/** The songs in mpv's queue, as the app sent them. */
export const queuedOnSnapcast = () =>
	[...entries.values()].flatMap((e) => ('track' in e && !e.track.clip ? [e.track.id] : []));

/** Modo DJ is on, or off: the remotes say it. */
export function setSnapcastDj(on: boolean) {
	if (state.dj === on) return;
	state.dj = on;
	pages.notify();
}

/**
 * mpv's playlist-shuffle, with the track that is on moved first, so that the whole queue still
 * comes after it.
 */
async function shuffleQueue() {
	await mpv.command(['playlist-shuffle']);
	const pos = (await mpv.command(['get_property', 'playlist-pos'])) as number;
	if (pos > 0) await mpv.command(['playlist-move', pos, 0]);
}

/**
 * Repeat and single, with mpv's options (https://mpv.io/manual/stable/#options-loop-playlist):
 * loop-playlist for repeat; keep-open=always for single, which stops at the end of each track
 * instead of going on to the next; and both, loop-file, which starts the track again.
 */
async function setLoops(repeat: boolean, single: boolean) {
	await mpv.command(['set_property', 'loop-playlist', repeat ? 'inf' : 'no']);
	await mpv.command(['set_property', 'loop-file', repeat && single ? 'inf' : 'no']);
	await mpv.command(['set_property', 'keep-open', single ? 'always' : 'no']);
}

export async function controlSnapcast(
	action: Exclude<SnapcastAction, { action: 'play' } | { action: 'append' } | { action: 'radio' }>
) {
	switch (action.action) {
		case 'pause':
			// A station connects again: back to live, not to where it was paused.
			// Loading it again does not unpause mpv: that goes first.
			if (!action.value && state.radio) {
				await mpv.command(['set_property', 'pause', false]);
				return radioOnSnapcast(state.radio);
			}
			// Stopped at the end of a track (single): mpv does not play it again by itself.
			if (!action.value && eofReached) await mpv.command(['seek', 0, 'absolute']);
			return mpv.command(['set_property', 'pause', action.value]);
		case 'seekTo':
			return mpv.command(['seek', action.value, 'absolute']);
		case 'next':
			if (state.radio) return;
			return mpv.command(['playlist-next']);
		case 'previous':
			if (state.radio) return;
			// Like the browser's: past the first seconds, back to the start of the track.
			return (state.positionSec ?? 0) > 3 || state.playlistPos === 1
				? mpv.command(['seek', 0, 'absolute'])
				: mpv.command(['playlist-prev']);
		case 'stop':
			return mpv.command(['stop']);
		case 'shuffle':
			await mpv.command(['set_property', 'shuffle', action.value]);
			if (!state.active || state.radio) return;
			return action.value ? shuffleQueue() : mpv.command(['playlist-unshuffle']);
		case 'repeat':
			return setLoops(action.value, state.single);
		case 'single':
			return setLoops(state.repeat, action.value);
		case 'volume':
			return speakers().setVolume(action.speakerId, { percent: action.value });
		case 'mute':
			return speakers().setVolume(action.speakerId, { muted: action.value });
		case 'masterVolume':
			return speakers().setMasterVolume(action.value);
		case 'masterMute':
			return speakers().setGroupsMuted(action.value);
		case 'rename':
			return speakers().setName(action.speakerId, action.name);
	}
}

/** The speakers as they are now, to choose a satellite's (Ajustes); null without snapserver. */
export async function listSpeakers() {
	if (!control) return null;
	try {
		await control.refresh();
	} catch {
		return null;
	}
	return structuredClone(state.speakers);
}

/** Lowered to this much of what it was while a satellite listens and answers, as mpv.ts's. */
const DUCKED = 0.3;
/** Never lowered for longer: a satellite that never says it ended (unplugged, restarted). */
const DUCK_MAX_MS = 60_000;
const ducked = new Map<
	string,
	{ from: number; to: number; timer: ReturnType<typeof setTimeout> }
>();
/** One after another: «on» still asking its volume when «off» comes would leave it low. */
const oneDuck = inOrder();

/**
 * A voice satellite's own speaker (#223, Ajustes) lowered while it hears an order and answers, so that
 * the music covers neither, and back as it was after; not back if someone changed it meanwhile.
 * Lowered even if nothing plays: mpv's state may not be known yet, and lowering silence does nothing.
 */
export const duckSpeaker = (id: string, on: boolean) =>
	oneDuck(async () => {
		const known = ducked.get(id);
		if (on) {
			if (known) {
				clearTimeout(known.timer);
				known.timer = setTimeout(() => void duckSpeaker(id, false), DUCK_MAX_MS);
				return;
			}
			await speakers().refresh();
			const speaker = state.speakers?.find((s) => s.id === id);
			if (!speaker?.connected || speaker.muted || !speaker.volume) return;
			const to = Math.round(speaker.volume * DUCKED);
			const timer = setTimeout(() => void duckSpeaker(id, false), DUCK_MAX_MS);
			ducked.set(id, { from: speaker.volume, to, timer });
			return speakers().setVolume(id, { percent: to });
		}
		if (!known) return;
		ducked.delete(id);
		clearTimeout(known.timer);
		const now = state.speakers?.find((s) => s.id === id)?.volume;
		if (now === known.to) return speakers().setVolume(id, { percent: known.from });
	});

function speakers() {
	if (!control) throw new Error('No hay control de snapserver configurado (SNAPSERVER_CONTROL)');
	return control;
}
