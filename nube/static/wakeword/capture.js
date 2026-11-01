// The microphone, as the wake word detector wants it (#144): an AudioWorklet in the AudioContext at
// the device's own rate (an AudioContext forced to 16 kHz gave next to nothing on Android), taken
// to 16 kHz here: a low-pass filter (windowed sinc, below 8 kHz) and linear interpolation. Each 80 ms
// (1280 samples) goes to the page as int16 values in floats, as openWakeWord takes them.
const TARGET = 16000;
const CHUNK = 1280;
const TAPS = 63;

class Capture extends AudioWorkletProcessor {
	constructor() {
		super();
		// `sampleRate` is the AudioContext's, in the worklet's global scope.
		this.step = sampleRate / TARGET;
		this.filter = this.step > 1 ? lowPass(7600 / sampleRate, TAPS) : null;
		this.history = new Float32Array(TAPS);
		this.at = 0;
		/** The filtered sample before the current one, and where the next output falls. */
		this.previous = 0;
		this.position = 0;
		this.buffer = new Float32Array(CHUNK);
		this.filled = 0;
	}

	emit(sample) {
		const s = Math.max(-1, Math.min(1, sample));
		this.buffer[this.filled++] = Math.round(s < 0 ? s * 32768 : s * 32767);
		if (this.filled === CHUNK) {
			this.port.postMessage(this.buffer);
			this.buffer = new Float32Array(CHUNK);
			this.filled = 0;
		}
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;
		for (let i = 0; i < channel.length; i++) {
			if (!this.filter) {
				this.emit(channel[i]);
				continue;
			}
			this.history[this.at] = channel[i];
			this.at = (this.at + 1) % TAPS;
			let filtered = 0;
			for (let k = 0; k < TAPS; k++)
				filtered += this.filter[k] * this.history[(this.at + k) % TAPS];
			// Outputs between the previous filtered sample (at 0) and this one (at 1).
			while (this.position <= 1) {
				this.emit(this.previous + (filtered - this.previous) * this.position);
				this.position += this.step;
			}
			this.position -= 1;
			this.previous = filtered;
		}
		return true;
	}
}

/** A low-pass FIR with `cutoff` as a fraction of the rate, Hann-windowed, gain 1. */
function lowPass(cutoff, taps) {
	const h = new Float32Array(taps);
	const mid = (taps - 1) / 2;
	let sum = 0;
	for (let n = 0; n < taps; n++) {
		const x = n - mid;
		const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
		h[n] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)));
		sum += h[n];
	}
	for (let n = 0; n < taps; n++) h[n] /= sum;
	return h;
}

registerProcessor('wakeword-capture', Capture);
