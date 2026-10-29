import { readWav, writeWav } from './wav.ts';

/**
 * A satellite's timer ringing (#223): two «din-don», as the phone's (timers.svelte.ts, `playChime`),
 * and then the voice saying which one, in one WAV, so that through Snapcast they sound together.
 */

/** Each «din-don»: high, then low, sine waves that fade. */
const NOTES = [
	{ hz: 880, at: 0 },
	{ hz: 660, at: 0.35 }
];
const NOTE_SEC = 0.9;
/** Two of them, this far apart, and this silence before the voice. */
const DING_DONGS = [0, 1.3];
const PAUSE_SEC = 0.5;
const LEVEL = 0.4;

/** The chime at `rate`, as 16-bit samples, one channel. */
export function chime(rate: number) {
	const last = DING_DONGS.at(-1)! + NOTES.at(-1)!.at + NOTE_SEC;
	const samples = new Float32Array(Math.round((last + PAUSE_SEC) * rate));
	for (const start of DING_DONGS)
		for (const note of NOTES) {
			const from = Math.round((start + note.at) * rate);
			const length = Math.round(NOTE_SEC * rate);
			for (let i = 0; i < length; i++) {
				const t = i / rate;
				// Up in 20 ms, then fading, as the phone's exponential ramps.
				const gain = LEVEL * Math.min(1, t / 0.02) * Math.exp((-5 * t) / NOTE_SEC);
				samples[from + i]! += gain * Math.sin(2 * Math.PI * note.hz * t);
			}
		}
	return Int16Array.from(samples, (s) => Math.round(Math.max(-1, Math.min(1, s)) * 32767));
}

/** The voice's WAV with the chime before it. */
export function withChime(wav: Uint8Array) {
	const { rate, channels, data } = readWav(wav);
	const mono = chime(rate);
	const pcm = new Int16Array(mono.length * channels);
	for (let i = 0; i < mono.length; i++)
		for (let c = 0; c < channels; c++) pcm[i * channels + c] = mono[i]!;
	const out = new Uint8Array(pcm.byteLength + data.length);
	out.set(new Uint8Array(pcm.buffer), 0);
	out.set(data, pcm.byteLength);
	return writeWav(rate, channels, out);
}
