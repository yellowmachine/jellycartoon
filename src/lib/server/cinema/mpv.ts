import path from 'node:path';
import { eq } from 'drizzle-orm';
import { MPV_SOCKET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { hostCinemaRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { MpvClient, StateBroadcast, type MpvMessage } from '#lib/server/mpv-client.ts';
import { saveProgress } from '#lib/server/progress.ts';
import type { RemoteAction, RemoteState, Track } from '#lib/salon.ts';

/**
 * Plays films and episodes on the host's screen: an mpv left waiting at MPV_SOCKET
 * (deploy/jellycartoon-mpv.service). Also the remote control: what mpv is doing, live, and
 * commands to change it.
 */

export const mpvEnabled = Boolean(MPV_SOCKET);

/** A film, or an episode with its WebVTT files (outside its HLS playlist, so added by hand). */
export type Target =
	| { movieId: number }
	| { episodeId: number; subtitles: { path: string; lang: string; label: string }[] };

/** Something to play, in the order it is queued. */
export interface QueueItem {
	target: Target;
	title: string;
	/** Above the title, e.g. the series and episode number. */
	subtitle: string | null;
	/** The file's path on the host, which is where mpv runs. */
	hostPath: string;
	startSec: number;
	durationSec: number | null;
}

/**
 * Who is watching what, by mpv's playlist entry id. Kept while the entry is in mpv's playlist, which
 * can go back to it, and until the last events of a replaced one.
 */
interface Playing extends QueueItem {
	userId: string;
	positionSec: number;
	subtitlesAdded?: boolean;
	/** Replaced by a new queue: forgotten once it ends. */
	replaced?: boolean;
}

const playing = new Map<number, Playing>();
/** Cine Club intros queued before a film: the film's title, by playlist entry id. */
const intros = new Map<number, string>();
/** Played by the app (a film or its intro), as opposed to something opened in mpv by hand. */
const ours = (entryId: number | null) =>
	entryId !== null && (playing.has(entryId) || intros.has(entryId));
/** The entry on screen now. */
let current: number | null = null;
/** The entry whose file mpv has finished opening (`file-loaded`): tracks can be added to it. */
let loaded: number | null = null;

const state: RemoteState = {
	available: false,
	active: false,
	movieId: null,
	episodeId: null,
	title: null,
	subtitle: null,
	intro: false,
	playlistPos: null,
	playlistCount: null,
	paused: false,
	positionSec: null,
	durationSec: null,
	volume: null,
	audioId: null,
	subtitleId: null,
	tracks: []
};

const SAVE_MS = 5_000;
let saveTimer: ReturnType<typeof setInterval> | null = null;

/** mpv properties the remote follows; changes arrive as `property-change` events. */
const OBSERVED = [
	'idle-active',
	'path',
	'pause',
	'time-pos',
	'duration',
	'volume',
	'aid',
	'sid',
	'track-list',
	'media-title',
	'playlist-pos',
	'playlist-count'
];

// Every open /salon page and salon bar gets the state as it changes.
const remotes = new StateBroadcast(state);
const notify = (positionOnly = false) => remotes.notify(positionOnly);

const mpv = new MpvClient(
	MPV_SOCKET ?? '',
	OBSERVED,
	{
		onConnect() {
			state.available = true;
			notify();
		},
		// mpv was closed (or restarted): whatever was playing keeps its last known position.
		onClose() {
			for (const entry of playing.values()) void save(entry, false);
			playing.clear();
			intros.clear();
			current = null;
			loaded = null;
			stopSaving();
			Object.assign(state, { available: false, ...NOTHING });
			notify();
		},
		onProperty: (name, data) => propertyChanged(name, data),
		onEvent: (message: MpvMessage) => {
			const entryId = message.playlist_entry_id;
			if (message.event === 'start-file' && entryId !== undefined) {
				current = entryId;
				show(entryId);
			} else if (message.event === 'file-loaded') {
				loaded = current;
				if (loaded !== null) void addSubtitles(loaded);
			} else if (message.event === 'end-file' && entryId !== undefined) {
				void ended(entryId, message.reason ?? '');
			}
		}
	},
	'mpv no está esperando en el salón: ¿está arrancado jellycartoon-mpv?',
	() => remotes.size > 0
);
const command = (cmd: unknown) => mpv.command(cmd);

interface MpvTrack {
	id: number;
	type: string;
	lang?: string;
	title?: string;
	forced?: boolean;
	'demux-channel-count'?: number;
}

/** What the remotes show while nothing of ours is on. */
const NOTHING = {
	active: false,
	movieId: null,
	episodeId: null,
	title: null,
	subtitle: null,
	intro: false
} satisfies Partial<RemoteState>;

/** The remotes show the entry now on screen: one of ours, its intro, or a file opened by hand. */
function show(entryId: number) {
	const entry = playing.get(entryId);
	const introOf = intros.get(entryId);
	Object.assign(state, {
		active: true,
		movieId: entry && 'movieId' in entry.target ? entry.target.movieId : null,
		episodeId: entry && 'episodeId' in entry.target ? entry.target.episodeId : null,
		title: entry?.title ?? introOf ?? state.title,
		subtitle: entry?.subtitle ?? null,
		intro: introOf !== undefined
	});
	notify();
}

/** Only the one in the user's language is selected; none when they want no subtitles. */
let preferredSubtitle: string | null = null;

/** Once per entry, when both its file is open and the entry is known (whichever comes last). */
async function addSubtitles(entryId: number) {
	const entry = playing.get(entryId);
	if (!entry || !('subtitles' in entry.target) || entry.subtitlesAdded || loaded !== entryId)
		return;
	entry.subtitlesAdded = true;
	let selected = false;
	for (const sub of entry.target.subtitles) {
		const select: boolean = !selected && sub.lang === preferredSubtitle;
		selected ||= select;
		await command(['sub-add', sub.path, select ? 'select' : 'auto', sub.label, sub.lang]).catch(
			(error) => log.warn('mpv', `No se pudieron añadir los subtítulos ${sub.path}`, { error })
		);
	}
}

function propertyChanged(name: string, data: unknown) {
	const number = typeof data === 'number' ? data : null;
	switch (name) {
		// Sent as soon as it is observed too: right after connecting, the remote already knows whether
		// something was playing (e.g. the app restarted mid-film).
		case 'idle-active':
			if (data !== false) {
				Object.assign(state, { ...NOTHING, positionSec: null });
				stopSaving();
			} else state.active = true;
			break;
		case 'path':
			if (typeof data === 'string' && !ours(current)) void identify(data);
			return;
		case 'pause':
			state.paused = data === true;
			break;
		case 'time-pos': {
			state.positionSec = number;
			const entry = current !== null ? playing.get(current) : undefined;
			if (entry && number !== null) entry.positionSec = number;
			// Many per second: the remotes get it once a second at most.
			notify(true);
			return;
		}
		case 'duration': {
			state.durationSec = number;
			// Episodes not probed yet still count as watched at the end.
			const entry = current !== null ? playing.get(current) : undefined;
			if (entry && !entry.durationSec) entry.durationSec = number;
			break;
		}
		case 'playlist-pos':
			state.playlistPos = number !== null && number >= 0 ? number + 1 : null;
			break;
		case 'playlist-count':
			state.playlistCount = number;
			break;
		case 'volume':
			state.volume = number;
			break;
		case 'aid':
			state.audioId = number;
			break;
		case 'sid':
			state.subtitleId = number;
			break;
		case 'track-list':
			state.tracks = ((data as MpvTrack[] | null) ?? [])
				.filter((t) => t.type === 'audio' || t.type === 'sub')
				.map((t) => ({
					id: t.id,
					type: t.type as Track['type'],
					lang: t.lang ?? null,
					title: t.title ?? null,
					forced: Boolean(t.forced),
					channels: t['demux-channel-count'] ?? null
				}));
			break;
		case 'media-title':
			// What the app plays (and the intro) keeps its catalogue title.
			if (!ours(current)) state.title = (data as string) ?? null;
			break;
	}
	notify();
}

/** A film already playing when the app connected: its catalogue title, if it is one of ours. */
async function identify(hostPath: string) {
	const relative = hostCinemaRoot ? path.relative(hostCinemaRoot, hostPath) : null;
	if (!relative || relative.startsWith('..')) return;
	const [film] = await db
		.select({ id: movie.id, title: movieTitle })
		.from(movie)
		.where(eq(movie.path, relative))
		.catch(() => []);
	if (!film) return;
	Object.assign(state, { movieId: film.id, title: film.title });
	notify();
}

/** `eof`: it reached the end. `stop`: another film replaced it, or it was stopped by hand. */
async function ended(entryId: number, reason: string) {
	const entry = playing.get(entryId);
	if (!entry) return;
	if (entry.replaced) playing.delete(entryId);
	if (current === entryId) current = null;
	await save(entry, reason === 'eof');
}

/** Past 92% (end credits) counts as watched, and the next time starts from the beginning. */
async function save(entry: Playing, reachedEnd: boolean) {
	const completed =
		reachedEnd || Boolean(entry.durationSec && entry.positionSec / entry.durationSec > 0.92);
	if ('episodeId' in entry.target) {
		const { episodeId } = entry.target;
		// Also ticks it off today's playlist and the user's lists.
		return saveProgress(entry.userId, episodeId, entry.positionSec, completed).catch((error) =>
			log.error('mpv', 'No se pudo guardar el progreso', { episodeId, error })
		);
	}
	const values = {
		userId: entry.userId,
		movieId: entry.target.movieId,
		positionSec: completed ? 0 : entry.positionSec,
		completed,
		updatedAt: new Date()
	};
	await db
		.insert(movieProgress)
		.values(values)
		.onConflictDoUpdate({ target: [movieProgress.userId, movieProgress.movieId], set: values })
		.catch((error) => log.error('mpv', 'No se pudo guardar el progreso', { ...values, error }));
}

function startSaving() {
	saveTimer ??= setInterval(() => {
		const entry = current !== null ? playing.get(current) : undefined;
		if (entry) void save(entry, false);
	}, SAVE_MS);
	saveTimer.unref();
}

function stopSaving() {
	if (saveTimer) clearInterval(saveTimer);
	saveTimer = null;
}

/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
export function watchRemote(listener: (state: RemoteState) => void) {
	const unwatch = remotes.watch(listener);
	mpv.connect().catch(() => mpv.keepTrying());
	return unwatch;
}

export async function control(remote: RemoteAction) {
	switch (remote.action) {
		case 'pause':
			return command(['set_property', 'pause', remote.value]);
		case 'seek':
			return command(['seek', remote.value, 'relative']);
		case 'seekTo':
			return command(['seek', remote.value, 'absolute']);
		case 'volume':
			return command(['set_property', 'volume', remote.value]);
		case 'audio':
			return command(['set_property', 'aid', remote.value]);
		case 'subtitle':
			return command(['set_property', 'sid', remote.value ?? 'no']);
		case 'next':
			return command(['playlist-next']);
		case 'previous':
			return command(['playlist-prev']);
		case 'stop':
			return command(['stop']);
	}
}

/**
 * Opens what is queued full screen on the host, replacing whatever was playing; mpv moves on to the
 * next item by itself. With `intro`, the Cine Club intro goes first.
 */
export async function play(options: {
	userId: string;
	items: QueueItem[];
	/** ISO 639-2 codes, as tagged in the tracks. */
	audioLang: string | null;
	subtitleLang: string | null;
	/** The intro's path on the host. */
	intro: string | null;
}) {
	preferredSubtitle = options.subtitleLang;
	// The old queue goes: what ended is already saved, and what is on saves when it ends.
	intros.clear();
	for (const [id, entry] of playing) {
		if (id === current) entry.replaced = true;
		else playing.delete(id);
	}
	let first = true;
	if (options.intro) {
		const intro = (await command({
			name: 'loadfile',
			url: options.intro,
			flags: 'replace'
		})) as { playlist_entry_id: number };
		intros.set(intro.playlist_entry_id, options.items[0].title);
		// start-file may have arrived before the entry was known.
		if (current === intro.playlist_entry_id) show(intro.playlist_entry_id);
		first = false;
	}
	for (const item of options.items) {
		// Options given to loadfile are the file's own: each item starts where it was left.
		const mpvOptions: Record<string, string> = { start: String(Math.floor(item.startSec)) };
		if (options.audioLang) mpvOptions.alang = options.audioLang;
		// Episodes' subtitles are added once loaded (addSubtitles).
		if (options.subtitleLang && 'movieId' in item.target) mpvOptions.slang = options.subtitleLang;
		const result = (await command({
			name: 'loadfile',
			url: item.hostPath,
			// append-play: it still plays if the intro could not be opened.
			flags: first ? 'replace' : 'append-play',
			options: mpvOptions
		})) as { playlist_entry_id: number };
		first = false;
		playing.set(result.playlist_entry_id, {
			...item,
			userId: options.userId,
			positionSec: item.startSec
		});
		if (current === result.playlist_entry_id) show(result.playlist_entry_id);
		void addSubtitles(result.playlist_entry_id);
	}
	startSaving();
	log.info(
		'mpv',
		`Reproduciendo ${options.items[0].hostPath} desde ${Math.floor(options.items[0].startSec)} s`,
		{ more: options.items.length - 1, intro: Boolean(options.intro) }
	);
}
