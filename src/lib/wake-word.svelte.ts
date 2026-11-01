import type { Listening } from 'comun/wakeword-listener.ts';
import { SPEECH_END, SpeechEnd, type SpeechEndReport, type Vad } from 'comun/vad.ts';
import { toWav } from 'comun/wakeword-recorder.ts';
import { voice } from '#lib/voice-client.svelte.ts';
import { DEFAULT_WAKE_WORD, isWakeWord, type WakeWordModel } from 'comun/wake-words.ts';

/**
 * Saying «hola casita» (or «Alexa», wake-words.ts) instead of pressing the microphone (#144, phase 2), on the phones and
 * tablets that turn it on in Ajustes. In the browser, like the microphone's mode. It listens while
 * the app is open and in front; heard, it beeps and what is said next goes to the voice
 * (voice-client.svelte.ts), until a silence (vad.ts). Nothing leaves the device but that order.
 * The same end, after a tap, is the microphone's third way (mic-mode.svelte.ts, `listenOnce`).
 */

const KEY = 'jellycartoon:wake-word';
/**
 * Which word, on this device (Ajustes, wake-words.ts). «Hola casita» by default: with music playing
 * on the tablet, the only one of the community's that went off well, and only with the sound not
 * cleaned; «Jelly Cartoon», even trained with music, did not (tried in /activacion, 2026-10-25).
 */
const WORD_KEY = 'jellycartoon:wake-word-model';
/**
 * The browser's cleaning (echo, noise, gain): only if this device asks for it (Ajustes), and only
 * while the app plays nothing on it (music or a video), as Android's took the voice away with the
 * music. Off unless asked: with the TV on (2026-10-25), the word went off better without it; and a
 * TV not played by the app cannot be known here.
 */
const CLEAN_KEY = 'jellycartoon:wake-word-clean';
/**
 * «Avanzado» (Ajustes): under the big microphone, the microphone's level, the word's score and its
 * threshold and cleaning, to try them where it is used (the kitchen, a video beside it).
 */
const ADVANCED_KEY = 'jellycartoon:wake-word-advanced';
/** With «Avanzado»: cleaned also while the app plays here, to compare. */
const CLEAN_PLAYING_KEY = 'jellycartoon:wake-word-clean-playing';
/** Sound on or off this long before the microphone is opened again, cleaned or not. */
const SWITCH_AFTER_MS = 2000;
/**
 * How sure the model must be, on this device (Ajustes): lower goes off more easily, and also by
 * itself more often. As /activacion's slider starts.
 */
const THRESHOLD_KEY = 'jellycartoon:wake-word-threshold';
export const WAKE_THRESHOLD = { min: 0.2, max: 0.8, step: 0.05, default: 0.5 };
/**
 * How much quieter than the voice (dB) speech is left out as a TV or a radio further away, on this
 * device (Ajustes, «Avanzado»): lower leaves out more, also the end of an order said softly.
 */
const MARGIN_KEY = 'jellycartoon:wake-word-margin';
export const WAKE_MARGIN = { min: 6, max: 30, step: 1, default: SPEECH_END.marginDb };
/** The word's level: the loudest of this long before it went off. */
const WORD_MS = 1500;
/** Busy (listening, thinking, reading the answer aloud) and this long after: not heard. */
const QUIET_MS = 1500;
/** As holding the button: longer than this, it is sent anyway. */
const MAX_MS = 30_000;

function stored(key = KEY) {
	try {
		return localStorage.getItem(key) === 'on';
	} catch {
		return false;
	}
}

function storedWord(): WakeWordModel {
	try {
		const value = localStorage.getItem(WORD_KEY);
		if (isWakeWord(value)) return value;
	} catch {
		// Private window: the default.
	}
	return DEFAULT_WAKE_WORD;
}

function storedThreshold() {
	try {
		const value = Number(localStorage.getItem(THRESHOLD_KEY));
		if (value >= WAKE_THRESHOLD.min && value <= WAKE_THRESHOLD.max) return value;
	} catch {
		// Private window: the default.
	}
	return WAKE_THRESHOLD.default;
}

function storedMargin() {
	try {
		const value = Number(localStorage.getItem(MARGIN_KEY));
		if (value >= WAKE_MARGIN.min && value <= WAKE_MARGIN.max) return value;
	} catch {
		// Private window: the default.
	}
	return WAKE_MARGIN.default;
}

function keep(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Private window: only forgotten.
	}
}

/** A score that went off, or came close (over half the threshold), for «Avanzado». */
export interface WakeHit {
	at: number;
	score: number;
	fired: boolean;
}

interface Order {
	vad: Vad;
	/** For its beeps. */
	context: AudioContext | null;
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
	threshold = $state(typeof window === 'undefined' ? WAKE_THRESHOLD.default : storedThreshold());
	/** The word it listens for (wake-words.ts). */
	word = $state<WakeWordModel>(typeof window === 'undefined' ? DEFAULT_WAKE_WORD : storedWord());
	/** Clean the sound while nothing plays here: off unless asked. */
	cleanWhenQuiet = $state(typeof window === 'undefined' ? false : stored(CLEAN_KEY));
	advanced = $state(typeof window === 'undefined' ? false : stored(ADVANCED_KEY));
	cleanWhilePlaying = $state(typeof window === 'undefined' ? false : stored(CLEAN_PLAYING_KEY));
	/** With «Avanzado»: the microphone's level (dBFS), the score now and its recent highest. */
	level = $state(-90);
	score = $state(0);
	peak = $state(0);
	hits = $state<WakeHit[]>([]);
	margin = $state(typeof window === 'undefined' ? WAKE_MARGIN.default : storedMargin());
	/** With «Avanzado»: the last order's voice and background levels. */
	lastOrder = $state<(SpeechEndReport & { at: number }) | null>(null);
	/** Cleaned now, as the microphone is open; and whether the app plays here. */
	cleaning = $state(false);
	playing = $state(false);
	/** A tap's own listener loading (the first time, a few MB). */
	preparing = $state(false);

	#wanted = false;
	#listening: Listening | null = null;
	#context: AudioContext | null = null;
	#paused = false;
	#order: Order | null = null;
	#quietUntil = 0;
	/** Cleaned now, or as it will open. */
	#clean = this.cleanWhenQuiet;
	/** Opened for a tap's order, with the word off (or not listening): closed after it. */
	#once: { listening: Listening; context: AudioContext } | null = null;
	/** A peak or a hit is being collected: the highest of an attempt, kept once it falls. */
	#attempt = 0;
	/** The app plays something on this device, as the layout last said. */
	#playing = false;
	#switchTimer: ReturnType<typeof setTimeout> | undefined;
	/** The microphone's last levels, for the word's (`WORD_MS`). */
	#recent: { at: number; dbfs: number }[] = [];

	/** A new word: listened for at once, if it was listening. */
	setWord(word: WakeWordModel) {
		if (word === this.word) return;
		this.word = word;
		keep(WORD_KEY, word === DEFAULT_WAKE_WORD ? null : word);
		if (this.status === 'off' || this.status === 'loading') return;
		this.#stop();
		if (this.#wanted) void this.#start();
	}

	setThreshold(value: number) {
		this.threshold = Math.min(WAKE_THRESHOLD.max, Math.max(WAKE_THRESHOLD.min, value));
		keep(THRESHOLD_KEY, String(this.threshold));
	}

	setMargin(value: number) {
		this.margin = Math.min(WAKE_MARGIN.max, Math.max(WAKE_MARGIN.min, value));
		keep(MARGIN_KEY, String(this.margin));
	}

	setCleanWhenQuiet(on: boolean) {
		this.cleanWhenQuiet = on;
		keep(CLEAN_KEY, on ? 'on' : null);
		this.#planCleaning();
	}

	setAdvanced(on: boolean) {
		this.advanced = on;
		keep(ADVANCED_KEY, on ? 'on' : null);
		// What it does stays as Ajustes says: the test is over.
		if (!on && this.cleanWhilePlaying) this.setCleanWhilePlaying(false);
	}

	setCleanWhilePlaying(on: boolean) {
		this.cleanWhilePlaying = on;
		keep(CLEAN_PLAYING_KEY, on ? 'on' : null);
		this.#planCleaning();
	}

	set(on: boolean) {
		this.on = on;
		try {
			if (on) localStorage.setItem(KEY, 'on');
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}

	/**
	 * From the layout: listening while it should (turned on, with voice, not in /activacion). After
	 * a start that failed (`problem`), tried again only once it was not wanted for a while.
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
					processing: this.#clean,
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
		// Something started or stopped playing while it loaded.
		void this.#listening.setProcessing(this.#clean).catch(() => {});
		this.cleaning = this.#clean;
		this.#paused = false;
		context.onstatechange = () => this.#showState();
		document.addEventListener('pointerdown', this.#unlock, true);
		document.addEventListener('keydown', this.#unlock, true);
		document.addEventListener('visibilitychange', this.#visibility);
		this.#showState();
		this.#visibility();
	}

	/**
	 * From the layout: whether the app plays something on this device, music or a video. With the
	 * cleaning asked for, once it has for a moment the microphone is opened again without it, and with
	 * it once it stops.
	 */
	sounding(playing: boolean) {
		this.#playing = playing;
		this.playing = playing;
		this.#planCleaning();
	}

	#planCleaning() {
		const clean = this.cleanWhenQuiet && (!this.#playing || this.cleanWhilePlaying);
		clearTimeout(this.#switchTimer);
		if (clean === this.#clean) return;
		this.#switchTimer = setTimeout(() => this.#switchCleaning(clean), SWITCH_AFTER_MS);
	}

	/** Not while an order is being said or answered (the voice pauses the music): after it. */
	#switchCleaning(clean: boolean) {
		if (this.#order || voice.phase !== 'idle' || voice.speaking) {
			this.#switchTimer = setTimeout(() => this.#switchCleaning(clean), SWITCH_AFTER_MS);
			return;
		}
		this.#clean = clean;
		this.cleaning = clean;
		this.#listening?.setProcessing(clean).catch((err) => {
			this.problem = err instanceof Error ? err.message : String(err);
		});
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

	/** As /activacion's bar: up at once, down slowly. */
	#level(dbfs: number) {
		const now = Date.now();
		this.#recent.push({ at: now, dbfs });
		while (this.#recent[0]!.at < now - WORD_MS) this.#recent.shift();
		if (this.advanced) this.level = Math.max(dbfs, this.level - 1.5);
	}

	#score(score: number) {
		if (this.advanced) this.#measure(score);
		if (this.#order) return;
		if (voice.phase !== 'idle' || voice.speaking) {
			this.#quietUntil = Date.now() + QUIET_MS;
			return;
		}
		if (score < this.threshold || Date.now() < this.#quietUntil) return;
		const vad = this.#listening?.vad();
		if (!vad || !voice.beginHandsFree()) return;
		// Said by whoever gives the order, as near: how loud their voice comes.
		const word = Math.max(...this.#recent.map((r) => r.dbfs));
		this.#begin(vad, this.#context, Number.isFinite(word) ? word : null);
	}

	/** For «Avanzado»: the score, its recent highest, and each attempt's highest once it falls. */
	#measure(score: number) {
		this.score = score;
		this.peak = Math.max(score, this.peak - 0.01);
		if (score >= this.threshold / 2) this.#attempt = Math.max(this.#attempt, score);
		else if (this.#attempt) {
			const best = this.#attempt;
			this.#attempt = 0;
			this.hits = [
				{ at: Date.now(), score: best, fired: best >= this.threshold },
				...this.hits
			].slice(0, 5);
		}
	}

	/**
	 * `voiceDb`: the word's level; after a tap, the order's first speech sets it. `waitMs`, how long
	 * for something to be said, if not the usual (SPEECH_END).
	 */
	#begin(
		vad: Vad,
		context: AudioContext | null,
		voiceDb: number | null = null,
		waitMs = SPEECH_END.waitMs
	) {
		this.#beep(880, context);
		this.#order = {
			vad,
			context,
			end: new SpeechEnd({ ...SPEECH_END, marginDb: this.margin, waitMs }, voiceDb),
			chunks: [],
			queue: Promise.resolve(),
			limit: setTimeout(() => this.#finish('done'), MAX_MS)
		};
	}

	/**
	 * The microphone's third way (Ajustes): a tap, and what is said goes until a silence, as after
	 * the word; also after a question of the AI, for its answer (voice-client.svelte.ts). Listening
	 * for the word, with its microphone; if not, one opened only for this order (the VAD, without
	 * the word), closed after it. A tap while it listens sends it now.
	 */
	async listenOnce({ waitMs = SPEECH_END.waitMs } = {}) {
		if (this.#order) return this.#finish('done');
		if (this.preparing || voice.phase !== 'idle' || voice.speaking) return;
		if (this.#listening && this.status === 'on' && !this.#paused) {
			const vad = this.#listening.vad();
			if (vad && voice.beginHandsFree()) this.#begin(vad, this.#context, null, waitMs);
			return;
		}
		// Now, on the tap, as the word's (see `listen`).
		const context = new AudioContext();
		if (!voice.beginHandsFree()) return void context.close();
		this.preparing = true;
		try {
			const { listen } = await import('comun/wakeword-listener.ts');
			const listening = await listen(
				{
					models: [],
					// As the microphone's button, which records with the browser's cleaning.
					processing: true,
					vad: true,
					onScores() {},
					onLevel: (dbfs) => this.#level(dbfs),
					onChunk: (chunk) => this.#chunk(chunk)
				},
				context
			);
			this.#once = { listening, context };
			document.addEventListener('visibilitychange', this.#onceHidden);
		} catch (err) {
			void context.close();
			voice.endHandsFree(null);
			voice.problem =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'No se puede usar el micrófono. Hay que darle permiso a la página.'
					: err instanceof Error
						? err.message
						: String(err);
			return;
		} finally {
			this.preparing = false;
		}
		const vad = this.#once.listening.vad();
		// Still wanted: nothing ended it while it loaded. And sounding: opened without a touch (after
		// a question), the browser may keep it stopped, and nothing would ever end the order.
		if (!vad || !voice.handsFree || context.state !== 'running') {
			this.#closeOnce();
			return voice.endHandsFree(null);
		}
		this.#begin(vad, context, null, waitMs);
	}

	/** In the background the browser stops the microphone: the order is dropped. */
	#onceHidden = () => {
		if (document.hidden) this.#cancel();
	};

	#closeOnce() {
		const once = this.#once;
		if (!once) return;
		this.#once = null;
		document.removeEventListener('visibilitychange', this.#onceHidden);
		once.listening.stop();
		void once.context.close();
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
		this.lastOrder = { ...order.end.report, at: Date.now() };
		this.#beep(said === 'done' ? 660 : 440, order.context);
		// After the beep's 150 ms: closing the sound cuts it.
		if (this.#once) setTimeout(() => this.#closeOnce(), 200);
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
		this.#closeOnce();
		voice.endHandsFree(null);
	}

	/** A short beep: when to speak, and that it heard. */
	#beep(hz: number, context = this.#context) {
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
