import net from 'node:net';
import { log } from '#lib/server/log.ts';
import type { Speaker } from '#lib/music.ts';

/**
 * Snapserver's clients, through its JSON-RPC control API over TCP, one message per line
 * (https://github.com/badaix/snapcast/blob/develop/doc/json_rpc_api/control.md): who is there,
 * and their volume and name. Changes made elsewhere (Snapdroid, Snapweb) arrive as notifications.
 */

interface SnapClient {
	id: string;
	connected: boolean;
	host: { name: string };
	config: { name: string; volume: { percent: number; muted: boolean } };
}

interface SnapServerStatus {
	groups: { clients: SnapClient[] }[];
}

const toSpeaker = (c: SnapClient): Speaker => ({
	id: c.id,
	name: c.config.name || c.host.name,
	hostName: c.host.name,
	connected: c.connected,
	volume: c.config.volume.percent,
	muted: c.config.volume.muted
});

export class SnapserverControl {
	#socket: net.Socket | null = null;
	#connecting: Promise<net.Socket> | null = null;
	#buffer = '';
	#nextId = 1;
	#pending = new Map<number, { resolve: (data: unknown) => void; reject: (e: Error) => void }>();
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#speakers = new Map<string, Speaker>();

	constructor(
		/** `host:port`. */
		private readonly address: string,
		/** The speakers, connected first; null while snapserver cannot be reached. */
		private readonly onChange: (speakers: Speaker[] | null) => void,
		/** Whether to keep trying to reconnect, e.g. while a page is open. */
		private readonly wanted: () => boolean
	) {}

	connect() {
		if (this.#socket) return Promise.resolve(this.#socket);
		this.#connecting ??= new Promise<net.Socket>((resolve, reject) => {
			const separator = this.address.lastIndexOf(':');
			const s = net.createConnection({
				host: this.address.slice(0, separator),
				port: Number(this.address.slice(separator + 1))
			});
			s.setEncoding('utf8');
			s.once('connect', () => {
				this.#socket = s;
				this.#connecting = null;
				resolve(s);
				this.request('Server.GetStatus')
					.then((result) => this.#replaceAll((result as { server: SnapServerStatus }).server))
					.catch((error) => log.warn('música', 'snapserver no da su estado', { error }));
			});
			s.on('error', (error: NodeJS.ErrnoException) => {
				if (this.#socket === s) return;
				this.#connecting = null;
				reject(new Error(`No se puede conectar con snapserver (${this.address}): ${error.code}`));
			});
			s.on('data', (chunk: string) => this.#onData(chunk));
			s.on('close', () => {
				if (this.#socket !== s) return;
				this.#socket = null;
				this.#buffer = '';
				for (const { reject } of this.#pending.values())
					reject(new Error('snapserver se ha cerrado'));
				this.#pending.clear();
				this.#speakers.clear();
				this.onChange(null);
				this.keepTrying();
			});
		});
		return this.#connecting;
	}

	/** While wanted, tries to reach snapserver every few seconds (e.g. while it restarts). */
	keepTrying() {
		if (this.#socket || this.#reconnectTimer || !this.wanted()) return;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.connect().catch(() => this.keepTrying());
		}, 5000);
	}

	async request(method: string, params?: unknown) {
		const s = await this.connect();
		const id = this.#nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error('snapserver no responde'));
			}, 5000);
			this.#pending.set(id, {
				resolve: (data) => {
					clearTimeout(timer);
					resolve(data);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				}
			});
			s.write(`${JSON.stringify({ id, jsonrpc: '2.0', method, params })}\r\n`);
		});
	}

	async setVolume(id: string, volume: { percent?: number; muted?: boolean }) {
		const current = this.#speakers.get(id);
		if (!current) throw new Error('Ese altavoz ya no está');
		const next = {
			percent: volume.percent ?? current.volume,
			muted: volume.muted ?? current.muted
		};
		await this.request('Client.SetVolume', { id, volume: next });
		// Here too, in case snapserver notifies only the other control clients.
		this.#update(id, { volume: next.percent, muted: next.muted });
	}

	/** An empty name goes back to the host's. */
	async setName(id: string, name: string) {
		const current = this.#speakers.get(id);
		if (!current) throw new Error('Ese altavoz ya no está');
		await this.request('Client.SetName', { id, name });
		this.#update(id, { name: name || current.hostName });
	}

	#onData(chunk: string) {
		this.#buffer += chunk;
		let newline: number;
		while ((newline = this.#buffer.indexOf('\n')) >= 0) {
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				log.warn('música', 'Mensaje de snapserver ilegible', { line });
				continue;
			}
			// A batch of notifications comes as an array.
			for (const m of Array.isArray(message) ? message : [message]) this.#handle(m);
		}
	}

	#handle(message: {
		id?: number;
		result?: unknown;
		error?: { message?: string };
		method?: string;
		params?: Record<string, unknown>;
	}) {
		if (typeof message.id === 'number' && this.#pending.has(message.id)) {
			const { resolve, reject } = this.#pending.get(message.id)!;
			this.#pending.delete(message.id);
			if (message.error) reject(new Error(`snapserver: ${message.error.message ?? 'error'}`));
			else resolve(message.result);
			return;
		}
		const params = message.params ?? {};
		switch (message.method) {
			case 'Client.OnConnect':
			case 'Client.OnDisconnect': {
				const client = params.client as SnapClient;
				this.#speakers.set(client.id, toSpeaker(client));
				return this.#emit();
			}
			case 'Client.OnVolumeChanged': {
				const volume = params.volume as { percent: number; muted: boolean };
				return this.#update(params.id as string, { volume: volume.percent, muted: volume.muted });
			}
			case 'Client.OnNameChanged': {
				const current = this.#speakers.get(params.id as string);
				return this.#update(params.id as string, {
					name: (params.name as string) || current?.hostName
				});
			}
			case 'Server.OnUpdate':
				return this.#replaceAll(params.server as SnapServerStatus);
		}
	}

	#replaceAll(server: SnapServerStatus) {
		this.#speakers = new Map(
			server.groups.flatMap((g) => g.clients).map((c) => [c.id, toSpeaker(c)])
		);
		this.#emit();
	}

	#update(id: string, changes: Partial<Speaker>) {
		const current = this.#speakers.get(id);
		if (!current) return;
		this.#speakers.set(id, { ...current, ...changes });
		this.#emit();
	}

	#emit() {
		this.onChange(
			[...this.#speakers.values()].sort(
				(a, b) =>
					Number(b.connected) - Number(a.connected) ||
					a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
			)
		);
	}
}
