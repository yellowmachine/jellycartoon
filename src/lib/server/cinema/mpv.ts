import net from 'node:net';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { MPV_SOCKET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movie, movieProgress, movieTitle } from '#lib/server/db/schema.ts';
import { hostCinemaRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import type { RemoteAction, RemoteState, Track } from '#lib/salon.ts';

/**
 * Plays films on the host's screen through mpv's JSON IPC (https://mpv.io/manual/stable/#json-ipc):
 * an mpv left waiting with `--idle --input-ipc-server=<MPV_SOCKET>` (deploy/jellycartoon-mpv.service).
 * Also the remote control: what mpv is doing, live, and commands to change it.
 */

export const mpvEnabled = Boolean(MPV_SOCKET);

/** Who is watching what, by mpv's playlist entry id: it outlives a replaced film's last events. */
interface Playing {
	userId: string;
	movieId: number;
	title: string;
	durationSec: number | null;
	positionSec: number;
}

const playing = new Map<number, Playing>();
/** The entry on screen now. */
let current: number | null = null;

const state: RemoteState = {
	available: false,
	active: false,
	movieId: null,
	title: null,
	paused: false,
	positionSec: null,
	durationSec: null,
	volume: null,
	audioId: null,
	subtitleId: null,
	tracks: []
};

let socket: net.Socket | null = null;
let connecting: Promise<net.Socket> | null = null;
let buffer = '';
let nextRequestId = 1;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();

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
	'media-title'
];

function connect() {
	if (socket) return Promise.resolve(socket);
	connecting ??= new Promise<net.Socket>((resolve, reject) => {
		const s = net.createConnection(MPV_SOCKET!);
		s.setEncoding('utf8');
		s.once('connect', () => {
			socket = s;
			connecting = null;
			state.available = true;
			OBSERVED.forEach((name, i) =>
				s.write(`${JSON.stringify({ command: ['observe_property', i + 1, name] })}\n`)
			);
			notify();
			resolve(s);
		});
		s.on('error', (error: NodeJS.ErrnoException) => {
			if (socket === s) return;
			connecting = null;
			reject(
				['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')
					? new Error('mpv no está esperando en el salón: ¿está arrancado jellycartoon-mpv?')
					: error
			);
		});
		s.on('data', (chunk: string) => onData(chunk));
		// mpv was closed (or restarted): whatever was playing keeps its last known position.
		s.on('close', () => {
			if (socket !== s) return;
			socket = null;
			buffer = '';
			for (const { reject } of pending.values()) reject(new Error('mpv se ha cerrado'));
			pending.clear();
			for (const entry of playing.values()) void save(entry, false);
			playing.clear();
			current = null;
			stopSaving();
			Object.assign(state, { available: false, active: false, movieId: null, title: null });
			notify();
			scheduleReconnect();
		});
	});
	return connecting;
}

async function command(cmd: unknown) {
	const s = await connect();
	const requestId = nextRequestId++;
	return new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error('mpv no responde'));
		}, 5000);
		pending.set(requestId, {
			resolve: (data) => {
				clearTimeout(timer);
				resolve(data);
			},
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			}
		});
		s.write(`${JSON.stringify({ command: cmd, request_id: requestId })}\n`);
	});
}

function onData(chunk: string) {
	buffer += chunk;
	let newline: number;
	while ((newline = buffer.indexOf('\n')) >= 0) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		if (!line.trim()) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			log.warn('mpv', 'Mensaje de mpv ilegible', { line });
			continue;
		}
		if (typeof message.request_id === 'number' && pending.has(message.request_id)) {
			const { resolve, reject } = pending.get(message.request_id)!;
			pending.delete(message.request_id);
			if (message.error === 'success') resolve(message.data);
			else reject(new Error(`mpv: ${message.error}`));
		} else if (message.event === 'property-change') {
			propertyChanged(message.name, message.data);
		} else if (message.event === 'start-file') {
			current = message.playlist_entry_id;
			const entry = playing.get(message.playlist_entry_id);
			Object.assign(state, {
				active: true,
				movieId: entry?.movieId ?? null,
				title: entry?.title ?? state.title
			});
			notify();
		} else if (message.event === 'end-file') {
			void ended(message.playlist_entry_id, message.reason);
		}
	}
}

interface MpvTrack {
	id: number;
	type: string;
	lang?: string;
	title?: string;
	forced?: boolean;
	'demux-channel-count'?: number;
}

function propertyChanged(name: string, data: unknown) {
	const number = typeof data === 'number' ? data : null;
	switch (name) {
		// Sent as soon as it is observed too: right after connecting, the remote already knows whether
		// something was playing (e.g. the app restarted mid-film).
		case 'idle-active':
			state.active = data === false;
			if (!state.active) Object.assign(state, { movieId: null, title: null, positionSec: null });
			break;
		case 'path':
			if (typeof data === 'string' && (current === null || !playing.has(current)))
				void identify(data);
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
		case 'duration':
			state.durationSec = number;
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
			// Films played from the app keep their catalogue title.
			if (current === null || !playing.has(current)) state.title = (data as string) ?? null;
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
	playing.delete(entryId);
	if (current === entryId) current = null;
	if (!playing.size) stopSaving();
	await save(entry, reason === 'eof');
}

/** Past 92% (end credits) counts as watched, and the next time starts from the beginning. */
async function save(entry: Playing, reachedEnd: boolean) {
	const completed =
		reachedEnd || Boolean(entry.durationSec && entry.positionSec / entry.durationSec > 0.92);
	const values = {
		userId: entry.userId,
		movieId: entry.movieId,
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

// --- Remotes: every open /salon page (and the bar on /cine) gets the state as it changes. ---

const listeners = new Set<(state: RemoteState) => void>();
let lastPositionSent = 0;
let positionTimer: ReturnType<typeof setTimeout> | null = null;

/** `positionOnly`: just a new `time-pos`, sent at most once a second. */
function notify(positionOnly = false) {
	if (positionOnly) {
		const wait = 1000 - (Date.now() - lastPositionSent);
		if (wait > 0) {
			positionTimer ??= setTimeout(() => {
				positionTimer = null;
				notify();
			}, wait);
			return;
		}
	}
	lastPositionSent = Date.now();
	const snapshot = structuredClone(state);
	for (const listener of listeners) listener(snapshot);
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** While a remote is open, keeps trying to reach mpv (e.g. while its service restarts). */
function scheduleReconnect() {
	if (!listeners.size || reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect().catch(() => scheduleReconnect());
	}, 5000);
}

/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
export function watchRemote(listener: (state: RemoteState) => void) {
	listeners.add(listener);
	listener(structuredClone(state));
	connect().catch(() => scheduleReconnect());
	return () => {
		listeners.delete(listener);
	};
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
		case 'stop':
			return command(['stop']);
	}
}

/** Opens the film full screen on the host, replacing whatever was playing. */
export async function playMovie(options: {
	userId: string;
	movieId: number;
	title: string;
	/** The file's path on the host, which is where mpv runs. */
	hostPath: string;
	startSec: number;
	durationSec: number | null;
	/** ISO 639-2 codes, as tagged in the films' tracks. */
	audioLang: string | null;
	subtitleLang: string | null;
}) {
	const mpvOptions: Record<string, string> = { start: String(Math.floor(options.startSec)) };
	if (options.audioLang) mpvOptions.alang = options.audioLang;
	if (options.subtitleLang) mpvOptions.slang = options.subtitleLang;

	const result = (await command({
		name: 'loadfile',
		url: options.hostPath,
		flags: 'replace',
		options: mpvOptions
	})) as { playlist_entry_id: number };

	playing.set(result.playlist_entry_id, {
		userId: options.userId,
		movieId: options.movieId,
		title: options.title,
		durationSec: options.durationSec,
		positionSec: options.startSec
	});
	// start-file may have arrived before the entry was known.
	if (current === result.playlist_entry_id) {
		Object.assign(state, { movieId: options.movieId, title: options.title });
		notify();
	}
	startSaving();
	log.info('mpv', `Reproduciendo ${options.hostPath} desde ${mpvOptions.start} s`, {
		movieId: options.movieId
	});
}
