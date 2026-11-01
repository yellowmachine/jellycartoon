import type { Listening } from 'comun/wakeword-listener.ts';
import { SPEECH_END, SpeechEnd, type Vad } from 'comun/vad.ts';
import { toWav } from 'comun/wakeword-recorder.ts';
import { isWakeWord, type WakeWordModel } from 'comun/wake-words.ts';
import { voice } from '#lib/voice-client.svelte.ts';

/**
 * Saying «Alexa» instead of pressing the microphone, in the road mode (jellycartoon's
 * src/lib/wake-word.svelte.ts, without its tests and cleaning): on the tablets that turn it on
 * there, kept in the browser. It listens while Carretera is open and in front; heard, it beeps,
 * what plays pauses, and what is said next goes to the voice until a silence (comun/vad.ts).
 * Nothing leaves the tablet but that order. The sound is not cleaned: with music playing on the
 * tablet, the word went off better without it (tried at home, 2026-10-25).
 */

const KEY = 'carretera-palabra';
const WORD_KEY = 'carretera-palabra-cual';
/** «Alexa» by default, as the satellites: the same word everywhere. */
export const ROAD_WAKE_WORD: WakeWordModel = 'alexa';
/** How sure the model must be: as at home and on the satellites. */
const THRESHOLD = 0.5;
/** The word's level: the loudest of this long before it went off. */
const WORD_MS = 1500;
/** Busy (listening, thinking, reading the answer aloud) and this long after: not heard. */
const QUIET_MS = 1500;
/** As holding the button: longer than this, it is sent anyway. */
const MAX_MS = 30_000;

function read(key: string) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function keep(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Private window: only forgotten.
	}
}

interface Order {
	vad: Vad;
	end: SpeechEnd;
	chunks: Int16Array[];
	/** One chunk at a time through the VAD. */
	queue: Promise<void>;
	limit: ReturnType<typeof setTimeout>;
}

class WakeWord {
	/** Turned on in Carretera, on this tablet. */
	on = $state(typeof window !== 'undefined' && read(KEY) === 'on');
	word = $state<WakeWordModel>(ROAD_WAKE_WORD);
	/** `tap`: listening, but the browser lets the sound start only after a touch on the page. */
	status = $state<'off' | 'loading' | 'on' | 'tap'>('off');
	problem = $state<string | null>(null);

	#wanted = false;
	#listening: Listening | null = null;
	#context: AudioContext | null = null;
	#paused = false;
	#order: Order | null = null;
	#quietUntil = 0;
	/** The microphone's last levels, for the word's (`WORD_MS`). */
	#recent: { at: number; dbfs: number }[] = [];

	constructor() {
		const word = typeof window === 'undefined' ? null : read(WORD_KEY);
		if (isWakeWord(word)) this.word = word;
	}

	set(on: boolean) {
		this.on = on;
		keep(KEY, on ? 'on' : null);
	}

	/** A new word: listened for at once, if it was listening. */
	setWord(word: WakeWordModel) {
		if (word === this.word) return;
		this.word = word;
		keep(WORD_KEY, word === ROAD_WAKE_WORD ? null : word);
		if (this.status === 'off' || this.status === 'loading') return;
		this.#stop();
		if (this.#wanted) void this.#start();
	}

	/**
	 * From the page: listening while it should (turned on, in Carretera). After a start that failed
	 * (`problem`), tried again only once it was not wanted for a while.
	 */
	want(wanted: boolean) {
		const again = wanted && this.#wanted;
		this.#wanted = wanted;
		if (wanted && this.status === 'off' && !(again && this.problem)) void this.#start();
		else if (!wanted && this.status !== 'loading') this.#stop();
	}

	async #start() {
		this.status = 'loading';
		this.problem = null;
		// Now, before loading anything: right after the tap that turned it on, it may start.
		const context = new AudioContext();
		this.#context = context;
		try {
			const { listen } = await import('comun/wakeword-listener.ts');
			this.#listening = await listen(
				{
					models: [this.word],
					processing: false,
					vad: true,
					onScores: ([score]) => this.#score(score ?? 0),
					onLevel: (dbfs) => this.#level(dbfs),
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
		document.removeEventListener('visibilitychange', this.#visibility);
		this.status = 'off';
	}

	#showState() {
		if (this.#listening) this.status = this.#context?.state === 'running' ? 'on' : 'tap';
	}

	/** Any touch lets a suspended sound start (the page opened with no touch yet). */
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

	#level(dbfs: number) {
		const now = Date.now();
		this.#recent.push({ at: now, dbfs });
		while (this.#recent[0]!.at < now - WORD_MS) this.#recent.shift();
	}

	#score(score: number) {
		if (this.#order) return;
		if (voice.phase !== 'idle' || voice.speaking) {
			this.#quietUntil = Date.now() + QUIET_MS;
			return;
		}
		if (score < THRESHOLD || Date.now() < this.#quietUntil) return;
		const vad = this.#listening?.vad();
		if (!vad || !voice.beginHandsFree()) return;
		// Said by whoever gives the order, as near: how loud their voice comes.
		const word = Math.max(...this.#recent.map((r) => r.dbfs));
		this.#beep(880);
		this.#order = {
			vad,
			end: new SpeechEnd(SPEECH_END, Number.isFinite(word) ? word : null),
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
				for (const { probability, dbfs } of await order.vad.push(chunk)) {
					const said = order.end.frame(probability, dbfs);
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

	/** An order half said, dropped: the page going to the background, or turned off. */
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
		// Louder than at home: over the road.
		gain.gain.setValueAtTime(0.3, context.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
		tone.connect(gain).connect(context.destination);
		tone.start();
		tone.stop(context.currentTime + 0.15);
	}
}

export const wakeWord = new WakeWord();
