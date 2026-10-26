/**
 * The microphone at its own rate taken to 16 kHz, as the browser's worklet does
 * (static/wakeword/capture.js): a low-pass filter (windowed sinc, below 8 kHz) and linear
 * interpolation. Asked to ALSA (`plughw` at 16 kHz), its `linear` converter does not filter first,
 * and «hola casita» scored 0.3 where the phone gave over 0.5 (2026-10-26, a USB microphone at 48 kHz).
 */

const TARGET = 16_000;
const TAPS = 63;

export class Resampler {
	#step: number;
	#filter: Float32Array | null;
	#history = new Float32Array(TAPS);
	#at = 0;
	/** The filtered sample before the current one, and where the next output falls. */
	#previous = 0;
	#position = 0;

	constructor(rate: number) {
		this.#step = rate / TARGET;
		this.#filter = this.#step > 1 ? lowPass(7600 / rate, TAPS) : null;
	}

	/** Mono samples at the microphone's rate, as int16 values: the same at 16 kHz. */
	push(samples: ArrayLike<number>): number[] {
		const out: number[] = [];
		for (let i = 0; i < samples.length; i++) {
			if (!this.#filter) {
				out.push(samples[i]!);
				continue;
			}
			this.#history[this.#at] = samples[i]!;
			this.#at = (this.#at + 1) % TAPS;
			let filtered = 0;
			for (let k = 0; k < TAPS; k++)
				filtered += this.#filter[k]! * this.#history[(this.#at + k) % TAPS]!;
			// Outputs between the previous filtered sample (at 0) and this one (at 1).
			while (this.#position <= 1) {
				const s = this.#previous + (filtered - this.#previous) * this.#position;
				out.push(Math.round(Math.max(-32768, Math.min(32767, s))));
				this.#position += this.#step;
			}
			this.#position -= 1;
			this.#previous = filtered;
		}
		return out;
	}
}

/** A low-pass FIR with `cutoff` as a fraction of the rate, Hann-windowed, gain 1. */
function lowPass(cutoff: number, taps: number) {
	const h = new Float32Array(taps);
	const mid = (taps - 1) / 2;
	let sum = 0;
	for (let n = 0; n < taps; n++) {
		const x = n - mid;
		const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
		h[n] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)));
		sum += h[n]!;
	}
	for (let n = 0; n < taps; n++) h[n]! /= sum;
	return h;
}
