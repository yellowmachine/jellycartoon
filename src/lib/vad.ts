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

	/** More audio, 16 kHz, as int16 values (as the wake word's). Each whole frame's probability. */
	async push(samples: ArrayLike<number>): Promise<number[]> {
		for (let i = 0; i < samples.length; i++) this.#pending.push(samples[i]! / 32768);
		const out: number[] = [];
		while (this.#pending.length >= VAD_FRAME) {
			const frame = this.#pending.splice(0, VAD_FRAME);
			const input = new Float32Array(CONTEXT + VAD_FRAME);
			input.set(this.#context);
			input.set(frame, CONTEXT);
			this.#context = input.slice(-CONTEXT);
			const { probability, state } = await this.run(input, this.#state);
			this.#state = state;
			out.push(probability);
		}
		return out;
	}
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
}

export const SPEECH_END: SpeechEndOptions = {
	waitMs: 5000,
	silenceMs: 1200,
	minSpeechMs: 250,
	maxSpeechMs: 8000
};

export class SpeechEnd {
	#ms = 0;
	#speech = 0;
	#silence = 0;
	#spoke = false;
	/** When the speech that is the order started. */
	#startedAt = 0;

	constructor(private options = SPEECH_END) {}

	/** Each frame's probability: still listening, the order said and over, or nothing said. */
	frame(probability: number): 'listening' | 'done' | 'nothing' {
		this.#ms += FRAME_MS;
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
		if (this.#spoke && this.#ms - this.#startedAt >= this.options.maxSpeechMs) return 'done';
		if (!this.#spoke && this.#ms >= this.options.waitMs) return 'nothing';
		return 'listening';
	}
}
