import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { MUSIC_MPV_SOCKET, SNAPCAST_PULSE_SOCKET, SNAPSERVER_CONTROL } from '$app/env/private';
import { inOrder } from '#lib/server/in-order.ts';
import { run } from '#lib/server/library/ffmpeg.ts';
import { log } from '#lib/server/log.ts';
import { MpvClient, StateBroadcast, type MpvMessage } from '#lib/server/mpv-client.ts';
import { saveProgress } from '#lib/server/progress.ts';
import { askEvery } from '#lib/server/still-there.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';
import type {
	MusicTrack,
	SnapcastAction,
	SnapcastEpisode,
	SnapcastState,
	SnapcastWhere
} from '#lib/music.ts';
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

/**
 * An episode listened to: whose progress it is, where it sounds (as /infantil's «Ahora» says it),
 * and where it goes, kept as it plays.
 */
interface Listening {
	episode: SnapcastEpisode;
	userId: string;
	place: string;
	positionSec: number;
	/** The one chosen: not started by itself. */
	chosen: boolean;
}

/** What each of mpv's playlist entries is: a track, a station, or an episode's audio. */
type Entry = { track: MusicTrack } | { radio: RadioStream } | { listening: Listening };
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
	episode: null,
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
		episode: entry && 'listening' in entry ? entry.listening.episode : null,
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
				episode: null,
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
						Object.assign(state, {
							track: null,
							radio: null,
							episode: null,
							nowPlaying: null,
							positionSec: null
						});
					break;
				case 'pause':
					state.paused = data === true;
					// Paused, where it was: «Seguir viendo» has it if nobody goes on.
					if (state.paused) void saveCurrent();
					break;
				case 'time-pos':
					state.positionSec = number;
					listened(number);
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
				void startedByItself(current);
			} else if (message.event === 'end-file' && message.playlist_entry_id !== undefined) {
				const entry = entries.get(message.playlist_entry_id);
				if (entry && 'listening' in entry) void save(entry.listening, message.reason === 'eof');
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

/**
 * Adds a track, a station or an episode to mpv's playlist; `insert-at` needs mpv 0.38 or later.
 * `options` are the file's own, e.g. where it starts.
 */
async function loadEntry(
	entry: Entry,
	url: string,
	how: { flags: 'replace' | 'append-play' } | { flags: 'insert-at'; index: number },
	options?: Record<string, string>
) {
	const result = (await mpv.command({ name: 'loadfile', url, ...how, options })) as {
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

/** Saved this often while an episode plays, as the browser does (episode-listening.svelte.ts). */
const SAVE_EVERY_MS = 15_000;
let savedAt = 0;

const listeningNow = () => {
	const entry = current === null ? undefined : entries.get(current);
	return entry && 'listening' in entry ? entry.listening : null;
};

/** Where the episode on goes: kept, and saved now and then. */
function listened(positionSec: number | null) {
	const listening = listeningNow();
	if (!listening || positionSec === null) return;
	listening.positionSec = positionSec;
	if (Date.now() - savedAt >= SAVE_EVERY_MS) void save(listening, false);
}

const saveCurrent = async () => {
	const listening = listeningNow();
	if (listening) await save(listening, false);
};

/** Its progress, as if watched (Past 92%, the end credits, it counts as watched), and its time. */
async function save(listening: Listening, reachedEnd: boolean) {
	savedAt = Date.now();
	const { episode, userId, place, positionSec } = listening;
	const completed =
		reachedEnd || Boolean(episode.durationSec && positionSec / episode.durationSec > 0.92);
	try {
		await addWatchTime(userId, { episodeId: episode.id }, positionSec, 'snapcast', place);
		await saveProgress(userId, episode.id, positionSec, completed);
	} catch (error) {
		log.error('música', 'No se pudo guardar el progreso del capítulo', { id: episode.id, error });
	}
}

/**
 * «¿Sigues ahí?» (#77) on Snapcast: episodes started by themselves since anyone touched anything.
 * Nobody can answer on a speaker, so at the user's number of them it stops instead of asking: for
 * falling asleep listening.
 */
let unattended = 0;

async function startedByItself(entryId: number) {
	const entry = entries.get(entryId);
	if (!entry || !('listening' in entry) || entry.listening.chosen) return;
	unattended++;
	const every = await askEvery(entry.listening.userId).catch(() => null);
	if (!every || unattended < every || current !== entryId) return;
	log.info('música', `Snapcast se para tras ${unattended} capítulos seguidos`, {
		userId: entry.listening.userId
	});
	// Not heard: its progress stays as it was.
	entries.delete(entryId);
	await mpv.command(['stop']).catch(() => {});
}

/**
 * Episodes' audio (#223), instead of whatever was on: each one's `url` as mpv opens it, from
 * `startSec`. Neither shuffled nor repeated: one after the other, until the last or «¿Sigues ahí?».
 */
export async function listenOnSnapcast(
	items: { episode: SnapcastEpisode; url: string; startSec: number }[],
	who: { userId: string; place: string }
) {
	if (!items.length) return;
	entries.clear();
	unattended = 0;
	await mpv.command(['set_property', 'shuffle', false]);
	await setLoops(false, false);
	for (const [i, item] of items.entries()) {
		const listening = { ...who, episode: item.episode, positionSec: item.startSec, chosen: !i };
		await loadEntry(
			{ listening },
			item.url,
			{ flags: i ? 'append-play' : 'replace' },
			{
				start: String(Math.floor(item.startSec))
			}
		);
	}
	log.info('música', `En Snapcast: ${items[0].episode.subtitle}, ${items.length} capítulos`, who);
}

/**
 * Every speaker, or only one and its group (snapserver.ts, `soundOnly`). Without snapserver's
 * control, the whole house is all there is.
 */
export async function soundOn(where: SnapcastWhere) {
	if (where === 'house' && !control) return;
	await speakers().soundOnly(where === 'house' ? null : where.speakerId);
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
	action: Exclude<
		SnapcastAction,
		{ action: 'play' } | { action: 'append' } | { action: 'radio' } | { action: 'episode' }
	>
) {
	// Someone is there: «¿Sigues ahí?» counts again.
	unattended = 0;
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
		await control.groups();
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
			await speakers().groups();
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

/** The streams of deploy/snapserver.conf: the music's, and that same music with one speaker's answers. */
const MUSIC_STREAM = 'JellyCartoon';
const VOICE_STREAM = 'Voz';
/**
 * PulseAudio's sinks for each (deploy/pulse.pa), and the role it lowers the music for: on `musica`,
 * the whole house's; on `voz`, only that of the speakers moved to it.
 */
const MUSIC_SINK = 'musica';
const VOICE_SINK = 'voz';
const VOICE_ROLE = 'announce';
/** Before saying it: the speakers just moved to the voice would miss its start. */
const LEAD_MS = 300;
/** After playing it, what is still in the FIFO and the clients' buffer (snapserver's, 1 s). */
const TAIL_MS = 1500;
/** Longer than this, paplay is stuck: given up. */
const SAY_MAX_MS = 120_000;
/** One answer at a time: two satellites at once would talk over each other. */
const oneAnswer = inOrder();

/** The satellites' answers can go to Snapcast: its PulseAudio is there, and its control. */
export const snapcastVoiceReady = () =>
	Boolean(control && SNAPCAST_PULSE_SOCKET && existsSync(SNAPCAST_PULSE_SOCKET));

/**
 * A voice satellite's answer (#223), Piper's WAV, said through Snapcast over the music, lowered
 * while it sounds. In the whole house, into the music itself: no speaker changes source, as each
 * change is near a second of silence. On one speaker (its id) and the rest of its group, they are
 * moved to the `Voz` source while it is said (the same music, with it) and back to what they played;
 * the others go on with the music as it is. Ends once it has been heard.
 */
export const sayOnSnapcast = (wav: Uint8Array, where: 'house' | string) =>
	oneAnswer(async () => {
		const all = await speakers().groups();
		const house = where === 'house';
		const groups = all.filter((g) => (house ? g.clients.length : g.clients.includes(where)));
		if (!groups.length) throw new Error('Ese altavoz ya no está en Snapcast');
		// Lowered while it listened (duckSpeaker), the answer would be too.
		for (const id of ducked.keys())
			if (groups.some((g) => g.clients.includes(id))) await duckSpeaker(id, false);
		const file = join(tmpdir(), `respuesta-${randomUUID()}.wav`);
		await writeFile(file, wav);
		const moved = house ? [] : groups;
		try {
			if (moved.length) {
				await Promise.all(moved.map((g) => speakers().setGroupStream(g.id, VOICE_STREAM)));
				await sleep(LEAD_MS);
			}
			// Its role is what lowers the music under it; paplay ends once PulseAudio has played it.
			const args = [`--server=unix:${SNAPCAST_PULSE_SOCKET}`];
			args.push(`--device=${house ? MUSIC_SINK : VOICE_SINK}`);
			args.push(`--property=media.role=${VOICE_ROLE}`, file);
			await run('paplay', args, { pausable: false, signal: AbortSignal.timeout(SAY_MAX_MS) });
			await sleep(TAIL_MS);
		} finally {
			await rm(file, { force: true });
			// Left on the voice by an answer cut short (the app restarted): to the music.
			const back = (g: (typeof groups)[number]) =>
				g.streamId === VOICE_STREAM ? MUSIC_STREAM : g.streamId;
			await Promise.all(moved.map((g) => speakers().setGroupStream(g.id, back(g))));
		}
	});

function speakers() {
	if (!control) throw new Error('No hay control de snapserver configurado (SNAPSERVER_CONTROL)');
	return control;
}
