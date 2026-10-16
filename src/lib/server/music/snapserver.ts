import net from 'node:net';
import { log } from '#lib/server/log.ts';
import { scaleVolumes, type Speaker } from '#lib/music.ts';

/**
 * Snapserver's clients, through its JSON-RPC control API over TCP, one message per line
 * (https://github.com/badaix/snapcast/blob/develop/doc/json_rpc_api/control.md): who is there,
 * their volume and name, and their groups' mute. Changes made elsewhere (Snapdroid, Snapweb)
 * arrive as notifications.
 */

interface SnapClient {
	id: string;
	connected: boolean;
	host: { name: string };
	config: { name: string; volume: { percent: number; muted: boolean } };
}

interface SnapGroup {
	id: string;
	muted: boolean;
	clients: SnapClient[];
}

interface SnapServerStatus {
	groups: SnapGroup[];
}

const toSpeaker = (c: SnapClient, group: { id: string; muted: boolean }): Speaker => ({
	id: c.id,
	name: c.config.name || c.host.name,
	hostName: c.host.name,
	connected: c.connected,
	volume: c.config.volume.percent,
	muted: c.config.volume.muted,
	groupId: group.id,
	groupMuted: group.muted
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
				this.#refresh();
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

	/** All the speakers that are on, keeping their balance (see scaleVolumes). */
	async setMasterVolume(value: number) {
		const volumes = scaleVolumes([...this.#speakers.values()], value);
		await Promise.all(volumes.map((v) => this.setVolume(v.id, { percent: v.volume })));
	}

	/** Mutes the groups of the speakers that are on, or unmutes them: Group.SetMute, as Snapweb. */
	async setGroupsMuted(mute: boolean) {
		const groups = new Set(
			[...this.#speakers.values()].filter((s) => s.connected).map((s) => s.groupId)
		);
		await Promise.all(
			[...groups].map(async (id) => {
				await this.request('Group.SetMute', { id, mute });
				this.#groupMuted(id, mute);
			})
		);
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
				const known = this.#speakers.get(client.id);
				// A new one: its group comes only with the whole status.
				if (!known) return this.#refresh();
				this.#speakers.set(
					client.id,
					toSpeaker(client, { id: known.groupId, muted: known.groupMuted })
				);
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
			case 'Group.OnMute':
				return this.#groupMuted(params.id as string, params.mute as boolean);
			case 'Server.OnUpdate':
				return this.#replaceAll(params.server as SnapServerStatus);
		}
	}

	#refresh() {
		this.request('Server.GetStatus')
			.then((result) => this.#replaceAll((result as { server: SnapServerStatus }).server))
			.catch((error) => log.warn('música', 'snapserver no da su estado', { error }));
	}

	#replaceAll(server: SnapServerStatus) {
		this.#speakers = new Map(
			server.groups.flatMap((g) => g.clients.map((c) => [c.id, toSpeaker(c, g)] as const))
		);
		this.#emit();
	}

	#groupMuted(groupId: string, muted: boolean) {
		for (const [id, s] of this.#speakers)
			if (s.groupId === groupId) this.#speakers.set(id, { ...s, groupMuted: muted });
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
