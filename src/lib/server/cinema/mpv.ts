import net from 'node:net';
import { MPV_SOCKET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { movieProgress } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';

/**
 * Plays films on the host's screen through mpv's JSON IPC (https://mpv.io/manual/stable/#json-ipc):
 * an mpv left waiting with `--idle --input-ipc-server=<MPV_SOCKET>` (deploy/jellycartoon-mpv.service).
 */

export const mpvEnabled = Boolean(MPV_SOCKET);

/** Who is watching what, by mpv's playlist entry id: it outlives a replaced film's last events. */
interface Playing {
	userId: string;
	movieId: number;
	durationSec: number | null;
	positionSec: number;
}

const playing = new Map<number, Playing>();
/** The entry on screen now, the one whose position is polled. */
let current: number | null = null;

let socket: net.Socket | null = null;
let buffer = '';
let nextRequestId = 1;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();
let poll: ReturnType<typeof setInterval> | null = null;

const POLL_MS = 5_000;

function connect() {
	if (socket) return Promise.resolve(socket);
	return new Promise<net.Socket>((resolve, reject) => {
		const s = net.createConnection(MPV_SOCKET!);
		s.setEncoding('utf8');
		s.once('connect', () => {
			socket = s;
			resolve(s);
		});
		s.on('error', (error: NodeJS.ErrnoException) => {
			if (socket !== s) {
				reject(
					['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')
						? new Error('mpv no está esperando en el salón: ¿está arrancado jellycartoon-mpv?')
						: error
				);
			}
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
			stopPolling();
		});
	});
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
		} else if (message.event === 'start-file') {
			current = message.playlist_entry_id;
		} else if (message.event === 'end-file') {
			void ended(message.playlist_entry_id, message.reason);
		}
	}
}

/** `eof`: it reached the end. `stop`: another film replaced it, or it was stopped by hand. */
async function ended(entryId: number, reason: string) {
	const entry = playing.get(entryId);
	if (!entry) return;
	playing.delete(entryId);
	if (current === entryId) current = null;
	if (!playing.size) stopPolling();
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

function startPolling() {
	poll ??= setInterval(async () => {
		const entry = current !== null ? playing.get(current) : undefined;
		if (!entry) return;
		const position = await command(['get_property', 'time-pos']).catch(() => null);
		if (typeof position !== 'number') return;
		entry.positionSec = position;
		await save(entry, false);
	}, POLL_MS);
	poll.unref();
}

function stopPolling() {
	if (poll) clearInterval(poll);
	poll = null;
}

/** Opens the film full screen on the host, replacing whatever was playing. */
export async function playMovie(options: {
	userId: string;
	movieId: number;
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

	// The film being replaced is saved where it really is, not where the last poll left it.
	const replaced = current !== null ? playing.get(current) : undefined;
	if (replaced) {
		const position = await command(['get_property', 'time-pos']).catch(() => null);
		if (typeof position === 'number') replaced.positionSec = position;
	}

	const result = (await command({
		name: 'loadfile',
		url: options.hostPath,
		flags: 'replace',
		options: mpvOptions
	})) as { playlist_entry_id: number };

	playing.set(result.playlist_entry_id, {
		userId: options.userId,
		movieId: options.movieId,
		durationSec: options.durationSec,
		positionSec: options.startSec
	});
	startPolling();
	log.info('mpv', `Reproduciendo ${options.hostPath} desde ${mpvOptions.start} s`, {
		movieId: options.movieId
	});
}
