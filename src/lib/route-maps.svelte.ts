import type { PMTiles } from 'pmtiles';
import { keepScreenOn } from '#lib/screen-on.ts';
import type { DeviceOrder, HeldMap, RouteMapReport } from '#lib/route-maps.ts';

/**
 * Routes' maps on this device (#164), such as the car's tablet: in the browser's own disk (Origin
 * Private File System, https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system),
 * asked to be kept (`navigator.storage.persist()`). Downloaded by pieces, so a cut connection goes
 * on from where it was. What it has to do, ordered from any device, it does when the app opens.
 */

const DEVICE_KEY = 'jellycartoon-mapas-dispositivo';
const FOLDER = 'mapas';
/** `ruta-12-ab12cd34ef56-22266928.pmtiles`: route, version and size; smaller than that, halfway. */
const NAME = /^ruta-(\d+)-([0-9a-f]+)-(\d+)\.pmtiles$/;
/** Written to disk every so much: what the browser has is kept if the page closes. */
const COMMIT_BYTES = 8_000_000;
/** Told to the server at most this often while downloading. */
const REPORT_MS = 3000;
const RETRIES = 5;
const RETRY_MS = 5000;

interface Device {
	id: string;
	name: string;
}

function readDevice(): Device | null {
	try {
		const value = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null');
		return value?.id && value?.name ? value : null;
	} catch {
		return null;
	}
}

const supported = () =>
	typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

async function folder() {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(FOLDER, { create: true });
}

async function post(url: string, body: unknown) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${res.status}`);
	return res.json();
}

/** Its files' names, all read before any is removed. */
async function namesIn(dir: FileSystemDirectoryHandle) {
	const names: string[] = [];
	for await (const name of dir.keys()) names.push(name);
	return names;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class RouteMaps {
	/** This device, if it keeps maps; null, it does not. */
	device = $state<Device | null>(null);
	/** Downloading now, and how far. */
	current = $state<{ routeId: number; progress: number } | null>(null);
	/** What it keeps whole, by route. */
	held = $state<HeldMap[]>([]);
	/** The browser said it keeps them even with little space (persist). */
	persisted = $state<boolean | null>(null);
	readonly supported = supported();
	/** Told when something changed: the page asks the server again. */
	onchange: (() => void) | null = null;
	#syncing: Promise<void> | null = null;

	constructor() {
		if (typeof localStorage !== 'undefined') this.device = readDevice();
	}

	/** This device keeps maps from now on, with this name (or renamed). */
	async register(name: string) {
		const id = this.device?.id ?? crypto.randomUUID();
		await post('/api/mapas/dispositivo', { id, name });
		this.device = { id, name };
		localStorage.setItem(DEVICE_KEY, JSON.stringify(this.device));
		void this.sync();
	}

	/** What there is on disk: whole, and halfway. */
	async #files() {
		const whole: (HeldMap & { name: string })[] = [];
		const halfway: { routeId: number; version: string; name: string; bytes: number }[] = [];
		for await (const [name, handle] of (await folder()).entries()) {
			const match = NAME.exec(name);
			if (!match || handle.kind !== 'file') continue;
			const file = await (handle as FileSystemFileHandle).getFile();
			const entry = { routeId: Number(match[1]), version: match[2]!, name, bytes: file.size };
			(file.size === Number(match[3]) ? whole : halfway).push(entry);
		}
		return { whole, halfway };
	}

	/** As the app opens: says what it has, and does what it was ordered. Once at a time. */
	sync() {
		if (!this.device || !this.supported) return Promise.resolve();
		// Without coverage, or the server away: the next time.
		this.#syncing ??= this.#sync()
			.catch(() => {})
			.finally(() => (this.#syncing = null));
		return this.#syncing;
	}

	async #sync() {
		const device = this.device!;
		const { whole, halfway } = await this.#files();
		this.held = whole.map(({ routeId, version, bytes }) => ({ routeId, version, bytes }));
		this.persisted = await navigator.storage.persisted();
		const res = await fetch('/api/mapas/sincronizar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: device.id, held: this.held })
		});
		if (res.status === 404) {
			// Forgotten from another device: what it kept goes.
			for (const f of [...whole, ...halfway]) await (await folder()).removeEntry(f.name);
			localStorage.removeItem(DEVICE_KEY);
			this.device = null;
			this.held = [];
			this.onchange?.();
			return;
		}
		if (!res.ok) return;
		const { name, orders }: { name: string; orders: DeviceOrder[] } = await res.json();
		if (name !== device.name) {
			this.device = { ...device, name };
			localStorage.setItem(DEVICE_KEY, JSON.stringify(this.device));
		}
		// Halfway without an order to go on: of no use.
		for (const f of halfway)
			if (!orders.some((o) => o.routeId === f.routeId && o.action === 'download'))
				await (await folder()).removeEntry(f.name);
		for (const order of orders) {
			if (order.action === 'remove') await this.#remove(order.routeId);
			else await this.#download(order.routeId);
			this.onchange?.();
		}
	}

	#report(report: RouteMapReport) {
		return post('/api/mapas/estado', { id: this.device!.id, ...report }).catch(() => {});
	}

	async #remove(routeId: number) {
		const dir = await folder();
		for (const name of await namesIn(dir))
			if (NAME.exec(name)?.[1] === String(routeId)) await dir.removeEntry(name);
		this.held = this.held.filter((h) => h.routeId !== routeId);
		await this.#report({ routeId, state: 'removed' });
	}

	/** Removed from here at once (on this same device). */
	async remove(routeId: number) {
		await this.#remove(routeId);
		this.onchange?.();
	}

	async #download(routeId: number) {
		const stopScreen = keepScreenOn(() => {});
		this.current = { routeId, progress: 0 };
		try {
			const ready: { url: string; bytes: number; version: string } = await post(
				`/api/mapas/recorrido/${routeId}`,
				{ device: this.device!.id }
			);
			const dir = await folder();
			const name = `ruta-${routeId}-${ready.version}-${ready.bytes}.pmtiles`;
			// Another version, whole or halfway: replaced.
			for (const other of await namesIn(dir))
				if (NAME.exec(other)?.[1] === String(routeId) && other !== name)
					await dir.removeEntry(other);
			const part = await dir.getFileHandle(name, { create: true });
			let at = (await part.getFile()).size;
			const { quota = 0, usage = 0 } = await navigator.storage.estimate();
			if (quota - usage < ready.bytes - at)
				throw new Error('No cabe: falta espacio en el dispositivo');
			await this.#report({ routeId, state: 'downloading', progress: at / ready.bytes });
			let reported = Date.now();
			for (let tries = 0; at < ready.bytes;) {
				try {
					const res = await fetch(ready.url, { headers: { range: `bytes=${at}-` } });
					if (res.status !== 206 || !res.body) throw new Error(`${res.status}`);
					const reader = res.body.getReader();
					let writable = await part.createWritable({ keepExistingData: true });
					await writable.seek(at);
					let unsaved = 0;
					try {
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							await writable.write(value);
							at += value.length;
							unsaved += value.length;
							tries = 0;
							if (unsaved >= COMMIT_BYTES) {
								await writable.close();
								writable = await part.createWritable({ keepExistingData: true });
								await writable.seek(at);
								unsaved = 0;
							}
							this.current = { routeId, progress: at / ready.bytes };
							if (Date.now() - reported > REPORT_MS) {
								reported = Date.now();
								void this.#report({ routeId, state: 'downloading', progress: at / ready.bytes });
							}
						}
					} finally {
						await writable.close().catch(() => {});
					}
				} catch (problem) {
					if (++tries > RETRIES) throw problem;
					// What was written stays: on from there.
					at = (await part.getFile()).size;
					await wait(RETRY_MS);
				}
			}
			// Its names and icons too, for when there is no coverage.
			await (await import('#lib/our-map.ts')).keepMapFiles();
			// Asked once there is something to keep; Chrome says yes to an installed app, or one used often.
			this.persisted = await navigator.storage.persist();
			this.held = [
				...this.held.filter((h) => h.routeId !== routeId),
				{ routeId, version: ready.version, bytes: ready.bytes }
			];
			await this.#report({
				routeId,
				state: 'ready',
				bytes: ready.bytes,
				version: ready.version
			});
		} catch (problem) {
			await this.#report({
				routeId,
				state: 'failed',
				problem:
					problem instanceof Error && problem.message.startsWith('No cabe')
						? problem.message
						: 'Se cortó la descarga: vuelve a pedirla'
			});
		} finally {
			this.current = null;
			stopScreen();
		}
	}

	/** The maps kept, opened to read their tiles: for the road mode's map. */
	async archives(): Promise<PMTiles[]> {
		if (!this.device || !this.supported) return [];
		const { PMTiles, FileSource } = await import('pmtiles');
		const { whole } = await this.#files();
		const dir = await folder();
		return Promise.all(
			whole.map(
				async (f) => new PMTiles(new FileSource(await (await dir.getFileHandle(f.name)).getFile()))
			)
		);
	}
}

export const routeMaps = new RouteMaps();
