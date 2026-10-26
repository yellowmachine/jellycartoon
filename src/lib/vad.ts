/**
 * When an order said after the wake word ends (#144): Silero VAD
 * (https://github.com/snakers4/silero-vad, static/wakeword/silero_vad.onnx) gives, every 32 ms, how
 * likely it is that it was speech; `SpeechEnd` decides from those when it was said and is over.
 *
 * As the wake word's detector, it only does the arithmetic: running the model is given (`VadRun`).
 */

/** 32 ms at 16 kHz: what the model takes each time. */
export const VAD_FRAME = 512;
/** The end of the frame before, in front of each: as silero-vad's `OnnxWrapper` in utils_vad.py. */
const CONTEXT = 64;
const FRAME_MS = 32;
/** silero-vad's `get_speech_timestamps`: speech from 0.5, silence under 0.15 less. */
const SPEECH = 0.5;
const SILENCE = SPEECH - 0.15;
/** The order's first speech this long sets how loud the voice comes, with the word's before it. */
const VOICE_MS = 600;

/** One frame: how likely it was speech, and how loud it came (dBFS). */
export interface VadFrame {
	probability: number;
	dbfs: number;
}

/** The model on one frame (with its context, −1…1) and its state: the probability and the new state. */
export type VadRun = (
	input: Float32Array,
	state: Float32Array
) => Promise<{ probability: number; state: Float32Array }>;

export class Vad {
	#state: Float32Array = new Float32Array(2 * 128);
	#context: Float32Array = new Float32Array(CONTEXT);
	/** Samples waiting for a whole frame. */
	#pending: number[] = [];

	constructor(private run: VadRun) {}

	/** More audio, 16 kHz, as int16 values (as the wake word's). Each whole frame's, with its level. */
	async push(samples: ArrayLike<number>): Promise<VadFrame[]> {
		for (let i = 0; i < samples.length; i++) this.#pending.push(samples[i]! / 32768);
		const out: VadFrame[] = [];
		while (this.#pending.length >= VAD_FRAME) {
			const frame = this.#pending.splice(0, VAD_FRAME);
			const input = new Float32Array(CONTEXT + VAD_FRAME);
			input.set(this.#context);
			input.set(frame, CONTEXT);
			this.#context = input.slice(-CONTEXT);
			const { probability, state } = await this.run(input, this.#state);
			this.#state = state;
			out.push({ probability, dbfs: level(frame) });
		}
		return out;
	}
}

/** As the listener's meter (wakeword-listener.ts): the mean power, in dBFS. */
export function level(samples: ArrayLike<number>) {
	let sum = 0;
	for (let i = 0; i < samples.length; i++) sum += samples[i]! ** 2;
	return 10 * Math.log10(sum / samples.length || 1e-9);
}

export interface SpeechEndOptions {
	/** Nothing said in this long after the wake word: it was not for us. */
	waitMs: number;
	/** Quiet this long after speaking: the order is over. */
	silenceMs: number;
	/** Less speech than this is a noise, not an order (silero-vad's `min_speech_duration_ms`). */
	minSpeechMs: number;
	/**
	 * Over this long after starting to speak, it is over all the same: an order is short, and a TV
	 * talking beside it (2026-10-26, a series in the living room) never leaves the silence.
	 */
	maxSpeechMs: number;
	/**
	 * Speech this much quieter (dB) than the voice that gave the order is a TV or a radio further
	 * away, not it: silence (2026-10-26, a TV not played by the app). `Infinity`: all speech counts.
	 */
	marginDb: number;
}

export const SPEECH_END: SpeechEndOptions = {
	waitMs: 5000,
	silenceMs: 1200,
	minSpeechMs: 250,
	maxSpeechMs: 8000,
	marginDb: 15
};

/** How an order ended, for «Avanzado»: the voice's level and the loudest speech left out. */
export interface SpeechEndReport {
	voiceDb: number | null;
	backgroundDb: number | null;
	/** Speech left out as background. */
	backgroundMs: number;
	/** Over at the cap (`maxSpeechMs`), not at a silence. */
	capped: boolean;
}

export class SpeechEnd {
	#ms = 0;
	#speech = 0;
	#silence = 0;
	#spoke = false;
	/** When the speech that is the order started. */
	#startedAt = 0;
	/** How loud the voice comes: the loudest of the word and of the order's first speech. */
	#voice: number | null;
	#background: number | null = null;
	#backgroundMs = 0;
	#capped = false;

	/** `voiceDb`: how loud the wake word came, said by the same person just before. */
	constructor(
		private options = SPEECH_END,
		voiceDb: number | null = null
	) {
		this.#voice = voiceDb;
	}

	get report(): SpeechEndReport {
		return {
			voiceDb: this.#voice,
			backgroundDb: this.#background,
			backgroundMs: this.#backgroundMs,
			capped: this.#capped
		};
	}

	/**
	 * Each frame's probability, and its level if known: still listening, the order said and over,
	 * or nothing said.
	 */
	frame(probability: number, dbfs?: number): 'listening' | 'done' | 'nothing' {
		this.#ms += FRAME_MS;
		if (probability >= SPEECH && dbfs !== undefined) {
			const early = !this.#speech || this.#ms - this.#startedAt <= VOICE_MS;
			if (early && (this.#voice === null || dbfs > this.#voice)) this.#voice = dbfs;
			else if (this.#voice !== null && dbfs < this.#voice - this.options.marginDb) {
				this.#background = Math.max(dbfs, this.#background ?? -Infinity);
				this.#backgroundMs += FRAME_MS;
				probability = 0;
			}
		}
		if (probability >= SPEECH) {
			if (!this.#speech) this.#startedAt = this.#ms - FRAME_MS;
			this.#speech += FRAME_MS;
			this.#silence = 0;
			if (this.#speech >= this.options.minSpeechMs) this.#spoke = true;
		} else if (probability < SILENCE) {
			this.#silence += FRAME_MS;
			// A noise too short to be speech, and quiet after it: waiting again.
			if (!this.#spoke && this.#silence >= this.options.silenceMs) this.#speech = 0;
		}
		if (this.#spoke && this.#silence >= this.options.silenceMs) return 'done';
		if (this.#spoke && this.#ms - this.#startedAt >= this.options.maxSpeechMs) {
			this.#capped = true;
			return 'done';
		}
		if (!this.#spoke && this.#ms >= this.options.waitMs) return 'nothing';
		return 'listening';
	}
}
