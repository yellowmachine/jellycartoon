import net from 'node:net';
import { log } from '#lib/server/log.ts';

/** A message from mpv that is not the answer to a command: an event, or a property change. */
export interface MpvMessage {
	event: string;
	name?: string;
	data?: unknown;
	playlist_entry_id?: number;
	reason?: string;
	/** With `end-file` and reason `error`, e.g. «loading failed». */
	file_error?: string;
	/** With `client-message`: what `script-message` sent. */
	args?: string[];
}

interface Handlers {
	/** Connected: the observed properties arrive right after, with their current values. */
	onConnect?: () => void;
	/** mpv was closed or restarted; it is tried again while `wanted()` says so. */
	onClose?: () => void;
	onProperty: (name: string, data: unknown) => void;
	onEvent?: (message: MpvMessage) => void;
}

/**
 * One mpv left waiting with `--idle --input-ipc-server=<socket>`, through its JSON IPC
 * (https://mpv.io/manual/stable/#json-ipc): commands, and the properties it is asked to observe.
 */
export class MpvClient {
	#socket: net.Socket | null = null;
	#connecting: Promise<net.Socket> | null = null;
	#buffer = '';
	#nextRequestId = 1;
	#pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly socketPath: string,
		private readonly observed: string[],
		private readonly handlers: Handlers,
		/** Shown when nothing listens on the socket. */
		private readonly notRunning: string,
		/** Whether to keep trying to reconnect, e.g. while a remote is open. */
		private readonly wanted: () => boolean
	) {}

	get connected() {
		return this.#socket !== null;
	}

	connect() {
		if (this.#socket) return Promise.resolve(this.#socket);
		this.#connecting ??= new Promise<net.Socket>((resolve, reject) => {
			const s = net.createConnection(this.socketPath);
			s.setEncoding('utf8');
			s.once('connect', () => {
				this.#socket = s;
				this.#connecting = null;
				this.observed.forEach((name, i) =>
					s.write(`${JSON.stringify({ command: ['observe_property', i + 1, name] })}\n`)
				);
				this.handlers.onConnect?.();
				resolve(s);
			});
			s.on('error', (error: NodeJS.ErrnoException) => {
				if (this.#socket === s) return;
				this.#connecting = null;
				reject(
					['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '') ? new Error(this.notRunning) : error
				);
			});
			s.on('data', (chunk: string) => this.#onData(chunk));
			s.on('close', () => {
				if (this.#socket !== s) return;
				this.#socket = null;
				this.#buffer = '';
				for (const { reject } of this.#pending.values()) reject(new Error('mpv se ha cerrado'));
				this.#pending.clear();
				this.handlers.onClose?.();
				this.keepTrying();
			});
		});
		return this.#connecting;
	}

	async command(cmd: unknown) {
		const s = await this.connect();
		const requestId = this.#nextRequestId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(requestId);
				reject(new Error('mpv no responde'));
			}, 5000);
			this.#pending.set(requestId, {
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

	/** While wanted, tries to reach mpv every few seconds (e.g. while its service restarts). */
	keepTrying() {
		if (this.#socket || this.#reconnectTimer || !this.wanted()) return;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.connect().catch(() => this.keepTrying());
		}, 5000);
	}

	#onData(chunk: string) {
		this.#buffer += chunk;
		let newline: number;
		while ((newline = this.#buffer.indexOf('\n')) >= 0) {
			const line = this.#buffer.slice(0, newline);
			this.#buffer = this.#buffer.slice(newline + 1);
			if (!line.trim()) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				log.warn('mpv', 'Mensaje de mpv ilegible', { line });
				continue;
			}
			if (typeof message.request_id === 'number' && this.#pending.has(message.request_id)) {
				const { resolve, reject } = this.#pending.get(message.request_id)!;
				this.#pending.delete(message.request_id);
				if (message.error === 'success') resolve(message.data);
				else reject(new Error(`mpv: ${message.error}`));
			} else if (message.event === 'property-change') {
				this.handlers.onProperty(message.name, message.data);
			} else if (message.event) {
				this.handlers.onEvent?.(message);
			}
		}
	}
}

/**
 * Sends a state to its listeners as it changes: at once, except for the position, which changes
 * many times a second and goes at most once a second.
 */
export class StateBroadcast<T> {
	#listeners = new Set<(state: T) => void>();
	#lastPositionSent = 0;
	#positionTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly state: T) {}

	get size() {
		return this.#listeners.size;
	}

	/** `positionOnly`: just a new position. */
	notify(positionOnly = false) {
		if (positionOnly) {
			const wait = 1000 - (Date.now() - this.#lastPositionSent);
			if (wait > 0) {
				if (!this.#positionTimer)
					this.#positionTimer = setTimeout(() => {
						this.#positionTimer = null;
						this.notify();
					}, wait);
				return;
			}
		}
		this.#lastPositionSent = Date.now();
		const snapshot = structuredClone(this.state);
		for (const listener of this.#listeners) listener(snapshot);
	}

	/** Calls `listener` with the current state and on every change; returns the unsubscribe. */
	watch(listener: (state: T) => void) {
		this.#listeners.add(listener);
		listener(structuredClone(this.state));
		return () => {
			this.#listeners.delete(listener);
		};
	}
}
