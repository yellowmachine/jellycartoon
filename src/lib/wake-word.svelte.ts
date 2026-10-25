import type { Listening } from '#lib/wakeword-listener.ts';
import { SpeechEnd, type Vad } from '#lib/vad.ts';
import { toWav } from '#lib/wakeword-recorder.ts';
import { voice } from '#lib/voice-client.svelte.ts';

/**
 * Saying «hola casita» instead of pressing the microphone (#144, phase 2), on the phones and
 * tablets that turn it on in Ajustes. In the browser, like the microphone's mode. It listens while
 * the app is open and in front; heard, it beeps and what is said next goes to the voice
 * (voice-client.svelte.ts), until a silence (vad.ts). Nothing leaves the device but that order.
 */

const KEY = 'jellycartoon:wake-word';
/**
 * The community's (static/wakeword/LEEME.md): with music playing on the tablet, the only one that
 * went off well, and only with the sound not cleaned; «Jelly Cartoon», even trained with music,
 * did not (tried in /activacion, 2026-10-25).
 */
const MODEL = 'hola_casita';
/**
 * The browser's echo cancellation and noise suppression, off: with music, Android's took the voice
 * away with it. What is said after the word is heard with the music already paused.
 */
const PROCESSING = false;
/** As /activacion's slider starts. */
const THRESHOLD = 0.5;
/** Busy (listening, thinking, reading the answer aloud) and this long after: not heard. */
const QUIET_MS = 1500;
/** As holding the button: longer than this, it is sent anyway. */
const MAX_MS = 30_000;

function stored() {
	try {
		return localStorage.getItem(KEY) === 'on';
	} catch {
		return false;
	}
}

interface Order {
	vad: Vad;
	end: SpeechEnd;
	chunks: Int16Array[];
	/** One chunk at a time through the VAD, as the wake word's. */
	queue: Promise<void>;
	limit: ReturnType<typeof setTimeout>;
}

class WakeWord {
	on = $state(typeof window === 'undefined' ? false : stored());
	/** `tap`: listening, but the browser lets the sound start only after a touch on the page. */
	status = $state<'off' | 'loading' | 'on' | 'tap'>('off');
	problem = $state<string | null>(null);

	#wanted = false;
	#listening: Listening | null = null;
	#context: AudioContext | null = null;
	#paused = false;
	#order: Order | null = null;
	#quietUntil = 0;

	set(on: boolean) {
		this.on = on;
		try {
			if (on) localStorage.setItem(KEY, 'on');
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}

	/** From the layout: listening while it should (turned on, with voice, not in /activacion). */
	want(wanted: boolean) {
		this.#wanted = wanted;
		if (wanted && this.status === 'off') void this.#start();
		else if (!wanted && this.status !== 'loading') this.#stop();
	}

	async #start() {
		this.status = 'loading';
		this.problem = null;
		// Now, before loading anything: right after the tap that turned it on, it may start.
		const context = new AudioContext();
		this.#context = context;
		try {
			const { listen } = await import('#lib/wakeword-listener.ts');
			this.#listening = await listen(
				{
					models: [MODEL],
					processing: PROCESSING,
					vad: true,
					onScores: ([score]) => this.#score(score ?? 0),
					onLevel() {},
					onChunk: (chunk) => this.#chunk(chunk)
				},
				context
			);
		} catch (err) {
			this.#stop();
			this.problem =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'No se puede usar el micrófono. Hay que darle permiso a la página.'
					: err instanceof Error
						? err.message
						: String(err);
			return;
		}
		// Turned off while it loaded.
		if (!this.#wanted) return this.#stop();
		this.#paused = false;
		context.onstatechange = () => this.#showState();
		document.addEventListener('pointerdown', this.#unlock, true);
		document.addEventListener('keydown', this.#unlock, true);
		document.addEventListener('visibilitychange', this.#visibility);
		this.#showState();
		this.#visibility();
	}

	#stop() {
		this.#cancel();
		this.#listening?.stop();
		this.#listening = null;
		if (this.#context && this.#context.state !== 'closed') void this.#context.close();
		this.#context = null;
		document.removeEventListener('pointerdown', this.#unlock, true);
		document.removeEventListener('keydown', this.#unlock, true);
		document.removeEventListener('visibilitychange', this.#visibility);
		this.status = 'off';
	}

	#showState() {
		if (this.#listening) this.status = this.#context?.state === 'running' ? 'on' : 'tap';
	}

	/** Any touch or key lets a suspended sound start (the app opened with no touch yet). */
	#unlock = () => {
		if (this.#context?.state === 'suspended') void this.#context.resume();
	};

	/** In the background the browser stops the microphone anyway: off, and on again when back. */
	#visibility = () => {
		const listening = this.#listening;
		if (!listening) return;
		if (document.hidden && !this.#paused) {
			this.#paused = true;
			this.#cancel();
			listening.pause();
		} else if (!document.hidden && this.#paused) {
			this.#paused = false;
			listening.resume().then(
				() => this.#showState(),
				(err) => {
					this.problem = err instanceof Error ? err.message : String(err);
				}
			);
		}
	};

	#score(score: number) {
		if (this.#order) return;
		if (voice.phase !== 'idle' || voice.speaking) {
			this.#quietUntil = Date.now() + QUIET_MS;
			return;
		}
		if (score < THRESHOLD || Date.now() < this.#quietUntil) return;
		const vad = this.#listening?.vad();
		if (!vad || !voice.beginHandsFree()) return;
		this.#beep(880);
		this.#order = {
			vad,
			end: new SpeechEnd(),
			chunks: [],
			queue: Promise.resolve(),
			limit: setTimeout(() => this.#finish('done'), MAX_MS)
		};
	}

	#chunk(chunk: Float32Array) {
		const order = this.#order;
		if (!order) return;
		order.chunks.push(Int16Array.from(chunk));
		order.queue = order.queue.then(async () => {
			if (this.#order !== order) return;
			try {
				for (const probability of await order.vad.push(chunk)) {
					const said = order.end.frame(probability);
					if (said !== 'listening') return this.#finish(said);
				}
			} catch (err) {
				console.error('VAD', err);
				this.#finish('nothing');
			}
		});
	}

	/** Said and over: sent as a WAV. Nothing said: what was paused plays again. */
	#finish(said: 'done' | 'nothing') {
		const order = this.#order;
		if (!order) return;
		this.#order = null;
		clearTimeout(order.limit);
		this.#beep(said === 'done' ? 660 : 440);
		if (said === 'nothing') return voice.endHandsFree(null);
		const samples = new Int16Array(order.chunks.reduce((n, c) => n + c.length, 0));
		let at = 0;
		for (const c of order.chunks) {
			samples.set(c, at);
			at += c.length;
		}
		voice.endHandsFree(new Blob([toWav(samples)], { type: 'audio/wav' }));
	}

	/** An order half said, dropped: the app going to the background, or turned off. */
	#cancel() {
		const order = this.#order;
		if (!order) return;
		this.#order = null;
		clearTimeout(order.limit);
		voice.endHandsFree(null);
	}

	/** A short beep: when to speak, and that it heard. */
	#beep(hz: number) {
		const context = this.#context;
		if (context?.state !== 'running') return;
		const tone = context.createOscillator();
		const gain = context.createGain();
		tone.frequency.value = hz;
		gain.gain.setValueAtTime(0.15, context.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
		tone.connect(gain).connect(context.destination);
		tone.start();
		tone.stop(context.currentTime + 0.15);
	}
}

export const wakeWord = new WakeWord();
