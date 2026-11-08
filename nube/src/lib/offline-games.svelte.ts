import { preloadCode } from '$app/navigation';
import { routeMaps } from 'comun/route-maps.svelte.ts';
import { keepScreenOn } from 'comun/screen-on.ts';
import { MAX_OFFLINE_BYTES, noRoomText } from '#lib/offline-music.ts';
import { offlineMusic } from '#lib/offline-music.svelte.ts';
import {
	EJS_CACHE,
	GAMES_CACHE,
	MANIFEST_KEY,
	PLAYER_PAGE,
	emulatorFiles,
	gameFiles,
	type OfflineGameOrder,
	type OfflineGameReport
} from '#lib/offline-games.ts';

/**
 * Games without coverage on this device, such as the car's tablet: the games ordered for it, with
 * their BIOS and box, the player's page and EmulatorJS' files for their consoles, in the browser's
 * cache (Cache Storage), where the service worker gives them to the player as if from the network
 * (service-worker/index.ts). Done when the app opens, after the music: what is missing comes
 * through Seilide, what is no longer ordered goes. In the same 2 GB as the music: the games ordered
 * first, first. Played from /juegos/aqui, which needs nothing from the server.
 */

const REPORT_MS = 3000;
const RETRIES = 3;
const RETRY_MS = 5000;
/** Files failing one after another: no coverage, the next time. */
const GIVE_UP = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (g: { system: string; file: string }) => `${g.system}/${g.file}`;

const supported = () =>
	typeof caches !== 'undefined' &&
	typeof navigator !== 'undefined' &&
	'serviceWorker' in navigator &&
	'storage' in navigator;

async function post(url: string, body: unknown) {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** A kept file's size; undefined, not kept. */
async function sizeIn(cache: Cache, url: string) {
	const kept = await cache.match(url);
	return kept ? (await kept.blob()).size : undefined;
}

class OfflineGames {
	readonly supported = supported();
	/** The games as last ordered, whole or not. */
	games = $state<OfflineGameOrder[]>([]);
	/** Those whose files are all here: they can be played without coverage. */
	ready = $state<string[]>([]);
	/** What its games take here (not the player's files, shared by them all). */
	bytes = $state(0);
	/** Downloading now: which game, and how far in its files. */
	current = $state<{ system: string; file: string; held: number; total: number } | null>(null);
	/** Told when something changed: the page asks the server again. */
	onchange: (() => void) | null = null;
	#opened: Promise<void> | null = null;
	#syncing: Promise<void> | null = null;

	isReady = (g: { system: string; file: string }) => this.ready.includes(keyOf(g));
	find = (system: string, file: string) =>
		this.games.find((g) => g.system === system && g.file === file);

	/** What there is here, read once; again after each sync. */
	whenOpen() {
		this.#opened ??= this.open();
		return this.#opened;
	}

	async open() {
		if (!this.supported) return;
		const [games, emulator] = await Promise.all([caches.open(GAMES_CACHE), caches.open(EJS_CACHE)]);
		const manifest = await games.match(MANIFEST_KEY);
		const list: OfflineGameOrder[] = manifest ? await manifest.json().catch(() => []) : [];
		const ready: string[] = [];
		let bytes = 0;
		for (const game of list) {
			let whole = Boolean(await games.match(PLAYER_PAGE));
			for (const url of gameFiles(game)) {
				const size = await sizeIn(games, url);
				if (size === undefined) whole = false;
				else bytes += size;
			}
			for (const url of emulatorFiles(game.player.core) ?? [])
				if (!(await emulator.match(url))) whole = false;
			if (whole) ready.push(keyOf(game));
		}
		this.games = list;
		this.ready = ready;
		this.bytes = bytes;
	}

	/** As the app opens, after the music's (whose room it shares). Once at a time. */
	sync() {
		if (!this.supported) return Promise.resolve();
		// Without coverage, or the house away: the next time.
		this.#syncing ??= this.#sync()
			.catch(() => {})
			.then(() => (this.#opened = this.open()))
			.catch(() => {})
			.finally(() => (this.#syncing = null));
		return this.#syncing;
	}

	async #sync() {
		const device = routeMaps.device;
		if (!device) return this.#clear();
		const res = await post('/api/juegos/sin-conexion/sincronizar', { id: device.id });
		// Forgotten from another device: what it carried goes.
		if (res.status === 404) return this.#clear();
		if (!res.ok) return;
		const { games: orders }: { games: OfflineGameOrder[] } = await res.json();
		if (!orders.length) return this.#clear();
		const [games, emulator] = await Promise.all([caches.open(GAMES_CACHE), caches.open(EJS_CACHE)]);
		// What no game ordered needs any more.
		const wanted = new Set(orders.flatMap(gameFiles).map((f) => new URL(f, location.href).href));
		const players = new Set(orders.flatMap((o) => emulatorFiles(o.player.core) ?? []));
		for (const request of await games.keys()) {
			const { pathname } = new URL(request.url);
			if (pathname === MANIFEST_KEY || pathname === PLAYER_PAGE) continue;
			if (!wanted.has(request.url)) await games.delete(request);
		}
		for (const request of await emulator.keys())
			if (!players.has(request.url)) await emulator.delete(request);
		await games.put(MANIFEST_KEY, Response.json(orders));
		this.games = orders;
		this.onchange?.();
		// The player's page as it is now, and this app's pages for them, ready to open with no network.
		const page = await fetch(PLAYER_PAGE).catch(() => null);
		if (page?.ok) await games.put(PLAYER_PAGE, page);
		await Promise.all([
			preloadCode('/juegos/aqui'),
			preloadCode('/juegos/aqui/[system]/[file]')
		]).catch(() => {});
		await this.#download(device.id, orders, games, emulator);
	}

	async #clear() {
		const had = this.games.length > 0;
		await caches.delete(GAMES_CACHE);
		await caches.delete(EJS_CACHE);
		this.games = [];
		if (had) this.onchange?.();
	}

	async #download(deviceId: string, orders: OfflineGameOrder[], games: Cache, emulator: Cache) {
		const sizes = new Map<string, number>();
		for (const order of orders)
			for (const url of gameFiles(order)) {
				const size = await sizeIn(games, url);
				if (size !== undefined) sizes.set(url, size);
			}
		const bytesOf = (order: OfflineGameOrder) =>
			gameFiles(order).reduce((sum, url) => sum + (sizes.get(url) ?? 0), 0);
		const report = (order: OfflineGameOrder, state: OfflineGameReport['state'], problem?: string) =>
			post('/api/juegos/sin-conexion/estado', {
				id: deviceId,
				system: order.system,
				file: order.file,
				state,
				bytes: bytesOf(order),
				...(problem && { problem })
			}).catch(() => {});
		let used = [...sizes.values()].reduce((a, b) => a + b, 0);
		const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
		let free = quota - usage;
		let failing = 0;
		let asked = false;
		const stopScreen = keepScreenOn(() => {});
		try {
			for (const order of orders) {
				const files = [
					...(emulatorFiles(order.player.core) ?? []).map((url) => ({ url, cache: emulator })),
					...gameFiles(order).map((url) => ({ url, cache: games }))
				];
				let reported = Date.now();
				let missed = 0;
				let full: string | null = null;
				for (const [i, { url, cache }] of files.entries()) {
					this.current = { system: order.system, file: order.file, held: i, total: files.length };
					if (await cache.match(url)) continue;
					const ownFile = cache === games;
					// Its music, in the same 2 GB.
					const room = ownFile
						? Math.min(MAX_OFFLINE_BYTES - offlineMusic.bytes - used, free)
						: free;
					const got = await this.#take(cache, url, room);
					if (got === 'full') {
						full =
							MAX_OFFLINE_BYTES - offlineMusic.bytes - used < free
								? noRoomText
								: 'No cabe: falta espacio en el dispositivo';
						break;
					}
					if (got === null) {
						missed++;
						if (++failing >= GIVE_UP) break;
						continue;
					}
					failing = 0;
					free -= got;
					if (ownFile) {
						sizes.set(url, got);
						used += got;
					}
					if (!asked) {
						// Asked once there is something to keep; Chrome says yes to an installed app.
						asked = true;
						await navigator.storage.persist().catch(() => false);
					}
					if (Date.now() - reported > REPORT_MS) {
						reported = Date.now();
						void report(order, 'downloading');
					}
				}
				// Cut off (no coverage): it goes on the next time, nothing failed.
				if (failing >= GIVE_UP) break;
				const why =
					full ??
					(missed
						? `${missed === 1 ? 'Un fichero no se pudo bajar' : `${missed} ficheros no se pudieron bajar`}: se vuelve a probar la próxima vez`
						: null);
				await report(order, why ? 'failed' : 'ready', why ?? undefined);
				this.onchange?.();
			}
			if (failing >= GIVE_UP) for (const order of orders) await report(order, 'downloading');
		} finally {
			this.current = null;
			stopScreen();
			this.onchange?.();
		}
	}

	/** A file into the cache: its size; `full`, it does not fit in `room`; null, it could not be had. */
	async #take(cache: Cache, url: string, room: number) {
		for (let tries = 0; tries < RETRIES; tries++) {
			try {
				const res = await fetch(url);
				if (!res.ok || !res.body) throw new Error(`${res.status}`);
				const length = Number(res.headers.get('content-length') ?? 0);
				if (length > room) {
					await res.body.cancel();
					return 'full' as const;
				}
				await cache.put(url, res);
				const size = (await sizeIn(cache, url)) ?? 0;
				if (size > room) {
					await cache.delete(url);
					return 'full' as const;
				}
				return size;
			} catch {
				await wait(RETRY_MS);
			}
		}
		await cache.delete(url).catch(() => false);
		return null;
	}
}

export const offlineGames = new OfflineGames();
