/**
 * Mensajes (#551): the device's own transcriber of voice notes (transcribe.worker.ts), one for the
 * page: the first time it downloads its model (~240 MB, kept by the browser), then only works.
 */
const RATE = 16_000;

/** A voice note's sound as Whisper takes it: 16 kHz, one channel. */
async function samplesOf(blob: Blob) {
	const raw = await blob.arrayBuffer();
	const decoded = await new AudioContext().decodeAudioData(raw);
	const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
	const src = offline.createBufferSource();
	src.buffer = decoded;
	src.connect(offline.destination);
	src.start();
	return (await offline.startRendering()).getChannelData(0);
}

class Transcriber {
	/** Downloading its model: how far (0–100), the files together. */
	downloading = $state<number | null>(null);
	busy = $state(false);
	#worker: Worker | null = null;
	#files = new Map<string, number>();
	#waiting = new Map<number, { ok: (t: string) => void; ko: (e: Error) => void }>();
	#next = 0;

	#start() {
		if (this.#worker) return this.#worker;
		const w = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (e) => {
			const m = e.data;
			if (m.kind === 'progress') {
				this.#files.set(m.file ?? '', m.progress);
				const all = [...this.#files.values()];
				this.downloading = Math.round(all.reduce((a, b) => a + b, 0) / all.length);
			} else if (m.kind === 'ready') this.downloading = null;
			else {
				const wait = this.#waiting.get(m.id);
				this.#waiting.delete(m.id);
				if (m.kind === 'text') wait?.ok(m.text);
				else wait?.ko(new Error(m.message));
			}
		};
		this.#worker = w;
		return w;
	}

	/** A voice note's text, made here. */
	async text(blob: Blob): Promise<string> {
		const samples = await samplesOf(blob);
		const w = this.#start();
		const id = ++this.#next;
		this.busy = true;
		try {
			return await new Promise<string>((ok, ko) => {
				this.#waiting.set(id, { ok, ko });
				w.postMessage({ id, samples }, [samples.buffer]);
			});
		} finally {
			this.busy = this.#waiting.size > 0;
			this.downloading = null;
		}
	}
}

export const transcriber = new Transcriber();

/** Whether the model was downloaded here already (the browser's cache of Transformers.js). */
export async function modelHere() {
	try {
		const keys = await (await caches.open('transformers-cache')).keys();
		return keys.some((r) => r.url.includes('whisper-small'));
	} catch {
		return false;
	}
}
