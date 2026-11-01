import type { MusicTrack } from 'comun/music.ts';
import { routeMaps } from 'comun/route-maps.svelte.ts';
import { keepScreenOn } from 'comun/screen-on.ts';
import {
	MAX_OFFLINE_BYTES,
	noRoomText,
	type OfflineListOrder,
	type OfflineListReport
} from '#lib/offline-music.ts';
import type { MusicPass } from '#lib/server/music.ts';

/**
 * Music without coverage on this device (#350), such as the car's tablet: the playlists ordered for
 * it, their songs (the house's Opus copies) and covers in the browser's own disk (Origin Private
 * File System), next to the routes' maps (#164) and on the same device. Done when the app opens:
 * what is missing comes from the house by the music pass, what no list has any more goes. A song in
 * two lists, once. At most 2 GB: the lists ordered first, first.
 */

const FOLDER = 'musica';
/** `pista-12.ogg`: whole, or not there (written at once on close; empty, it was cut). */
const TRACK = /^pista-(\d+)\.ogg$/;
const COVER = /^portada-(\d+)$/;
/** The lists as the server last said them: to play them with the house away. */
const MANIFEST = 'listas.json';
const REPORT_MS = 3000;
const RETRIES = 3;
const RETRY_MS = 5000;
/** Songs failing one after another: no coverage, the next time. */
const GIVE_UP = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const supported = () =>
	typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

async function folder() {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(FOLDER, { create: true });
}

async function post(url: string, body: unknown) {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** What there is on disk, by name and size (whole ones only, more than nothing). */
async function filesIn(dir: FileSystemDirectoryHandle) {
	const files = new Map<string, number>();
	for await (const [name, handle] of dir.entries()) {
		if (handle.kind !== 'file') continue;
		files.set(name, (await (handle as FileSystemFileHandle).getFile()).size);
	}
	return files;
}

/** Written whole or not at all: the browser keeps it aside until it is closed. */
async function save(
	dir: FileSystemDirectoryHandle,
	name: string,
	body: ReadableStream<Uint8Array>
) {
	const handle = await dir.getFileHandle(name, { create: true });
	await body.pipeTo(await handle.createWritable());
	return (await handle.getFile()).size;
}

class OfflineMusic {
	/** Downloading now: which list, and how far. */
	current = $state<{ playlistId: number; held: number; total: number } | null>(null);
	readonly supported = supported();
	/** Told when something changed: the page asks the server again. */
	onchange: (() => void) | null = null;
	/** The lists as last ordered, to play them with the house away. */
	lists = $state<OfflineListOrder[]>([]);
	/** What it keeps, to sound from here: by track, and covers by album. */
	#tracks = new Map<number, string>();
	#covers = new Map<number, string>();
	#syncing: Promise<void> | null = null;

	/** The kept song's address in this browser; undefined, not kept. */
	urlOf = (id: number) => this.#tracks.get(id);
	coverOf = (albumId: number) => this.#covers.get(albumId);
	has = (id: number) => this.#tracks.has(id);

	/**
	 * What there is on disk, opened to play (blob: addresses of the files themselves, nothing read
	 * into memory). Those gone are let go; those still there keep theirs, playing or not.
	 */
	async open() {
		if (!this.supported || !routeMaps.device) return;
		const dir = await folder();
		const seen = { tracks: new Set<number>(), covers: new Set<number>() };
		for await (const [name, handle] of dir.entries()) {
			if (handle.kind !== 'file') continue;
			const track = TRACK.exec(name);
			const cover = COVER.exec(name);
			const kind = track ? 'tracks' : cover ? 'covers' : null;
			if (!kind) continue;
			const id = Number((track ?? cover)![1]);
			const map = kind === 'tracks' ? this.#tracks : this.#covers;
			seen[kind].add(id);
			if (map.has(id)) continue;
			const file = await (handle as FileSystemFileHandle).getFile();
			if (file.size) map.set(id, URL.createObjectURL(file));
		}
		for (const [kind, map] of [
			['tracks', this.#tracks],
			['covers', this.#covers]
		] as const)
			for (const [id, url] of map)
				if (!seen[kind].has(id)) {
					URL.revokeObjectURL(url);
					map.delete(id);
				}
		this.lists = await dir
			.getFileHandle(MANIFEST)
			.then(async (h) => JSON.parse(await (await h.getFile()).text()) as OfflineListOrder[])
			.catch(() => []);
	}

	/** As the app opens, after the maps' (which may forget the device). Once at a time. */
	sync() {
		if (!this.supported) return Promise.resolve();
		// Without coverage, or the house away: the next time.
		this.#syncing ??= this.#sync()
			.catch(() => {})
			.then(() => this.open())
			.catch(() => {})
			.finally(() => (this.#syncing = null));
		return this.#syncing;
	}

	async #sync() {
		const dir = await folder();
		const device = routeMaps.device;
		if (!device) return this.#clear(dir);
		const res = await post('/api/musica/sin-conexion/sincronizar', { id: device.id });
		// Forgotten from another device: what it carried goes.
		if (res.status === 404) return this.#clear(dir);
		if (!res.ok) return;
		const { lists }: { lists: OfflineListOrder[] } = await res.json();
		const files = await filesIn(dir);
		const wanted = new Map<number, MusicTrack>();
		for (const list of lists)
			for (const t of list.tracks) if (!t.src && !t.clip) wanted.set(t.id, t);
		const covers = new Set([...wanted.values()].filter((t) => t.hasCover).map((t) => t.albumId));
		for (const [name, size] of files) {
			const track = TRACK.exec(name);
			const cover = COVER.exec(name);
			const keep =
				name === MANIFEST ||
				(track && size > 0 && wanted.has(Number(track[1]))) ||
				(cover && size > 0 && covers.has(Number(cover[1])));
			if (!keep) {
				await dir.removeEntry(name);
				files.delete(name);
			}
		}
		await this.#write(dir, lists);
		this.onchange?.();
		if (!lists.length) return;
		await this.#download(dir, device.id, lists, files);
	}

	async #write(dir: FileSystemDirectoryHandle, lists: OfflineListOrder[]) {
		const body = new Blob([JSON.stringify(lists)]).stream();
		await save(dir, MANIFEST, body);
	}

	async #clear(dir: FileSystemDirectoryHandle) {
		const names = [...(await filesIn(dir)).keys()];
		for (const name of names) await dir.removeEntry(name);
		if (names.length) this.onchange?.();
	}

	async #download(
		dir: FileSystemDirectoryHandle,
		deviceId: string,
		lists: OfflineListOrder[],
		files: Map<string, number>
	) {
		const sizeOf = (t: MusicTrack) => files.get(`pista-${t.id}.ogg`);
		const songs = (list: OfflineListOrder) => list.tracks.filter((t) => !t.src && !t.clip);
		const report = (
			list: OfflineListOrder,
			state: OfflineListReport['state'],
			problem?: string
		) => {
			const tracks = songs(list);
			const held = tracks.filter((t) => sizeOf(t) !== undefined);
			const bytes = held.reduce((sum, t) => sum + sizeOf(t)!, 0);
			const done = held.length === tracks.length;
			return post('/api/musica/sin-conexion/estado', {
				id: deviceId,
				playlistId: list.id,
				state: done ? 'ready' : state,
				held: held.length,
				total: tracks.length,
				bytes,
				...(problem && !done && { problem })
			}).catch(() => {});
		};
		const pass = await this.#pass();
		if (!pass) {
			for (const list of lists) await report(list, 'downloading');
			return;
		}
		let used = 0;
		for (const t of new Map(lists.flatMap((l) => songs(l).map((s) => [s.id, s]))).values())
			used += sizeOf(t) ?? 0;
		const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
		let free = quota - usage;
		let full: string | null = null;
		let failing = 0;
		let asked = false;
		const stopScreen = keepScreenOn(() => {});
		try {
			for (const list of lists) {
				const tracks = songs(list);
				let reported = Date.now();
				let missed = 0;
				for (const track of tracks) {
					const held = () => tracks.filter((t) => sizeOf(t) !== undefined).length;
					this.current = { playlistId: list.id, held: held(), total: tracks.length };
					if (full || sizeOf(track) !== undefined) continue;
					const got = await this.#take(dir, pass, track, Math.min(MAX_OFFLINE_BYTES - used, free));
					if (got === 'full') {
						full =
							MAX_OFFLINE_BYTES - used < free
								? noRoomText
								: 'No cabe: falta espacio en el dispositivo';
						continue;
					}
					if (got === null) {
						// Its file at the house may be the problem: the next one.
						missed++;
						if (++failing >= GIVE_UP) break;
						continue;
					}
					failing = 0;
					files.set(`pista-${track.id}.ogg`, got);
					used += got;
					free -= got;
					if (track.hasCover && !files.has(`portada-${track.albumId}`)) {
						const size = await this.#cover(dir, pass, track.albumId);
						if (size) files.set(`portada-${track.albumId}`, size);
					}
					if (!asked) {
						// Asked once there is something to keep; Chrome says yes to an installed app.
						asked = true;
						await navigator.storage.persist().catch(() => false);
					}
					if (Date.now() - reported > REPORT_MS) {
						reported = Date.now();
						void report(list, 'downloading');
					}
				}
				// Cut off (no coverage): it goes on the next time, nothing failed.
				if (failing >= GIVE_UP) break;
				const why =
					full ??
					(missed
						? `${missed === 1 ? 'Una canción no se pudo bajar' : `${missed} canciones no se pudieron bajar`}: se vuelve a probar la próxima vez`
						: null);
				await report(list, why ? 'failed' : 'downloading', why ?? undefined);
				this.onchange?.();
			}
			if (failing >= GIVE_UP) for (const list of lists) await report(list, 'downloading');
		} finally {
			this.current = null;
			stopScreen();
			this.onchange?.();
		}
	}

	/** A pass to the house's songs; null, the house does not give one now. */
	async #pass(): Promise<MusicPass | null> {
		const res = await fetch('/api/musica/pase', { method: 'POST' }).catch(() => null);
		return res?.ok ? res.json() : null;
	}

	/** A song to disk: its size; `full`, it does not fit in `room`; null, it could not be had. */
	async #take(dir: FileSystemDirectoryHandle, pass: MusicPass, track: MusicTrack, room: number) {
		const name = `pista-${track.id}.ogg`;
		for (let tries = 0; tries < RETRIES; tries++) {
			try {
				const res = await fetch(`${pass.base}/pistas/${track.id}`);
				if (!res.ok || !res.body) throw new Error(`${res.status}`);
				const length = Number(res.headers.get('content-length') ?? 0);
				if (length > room) {
					await res.body.cancel();
					return 'full' as const;
				}
				const size = await save(dir, name, res.body);
				if (size > room) {
					await dir.removeEntry(name);
					return 'full' as const;
				}
				if (size > 0) return size;
			} catch {
				await wait(RETRY_MS);
			}
		}
		await dir.removeEntry(name).catch(() => {});
		return null;
	}

	async #cover(dir: FileSystemDirectoryHandle, pass: MusicPass, albumId: number) {
		try {
			const res = await fetch(`${pass.base}/portadas/${albumId}`);
			if (!res.ok || !res.body) return null;
			return await save(dir, `portada-${albumId}`, res.body);
		} catch {
			return null;
		}
	}
}

export const offlineMusic = new OfflineMusic();
