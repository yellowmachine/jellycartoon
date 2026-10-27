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

/** Piper's WAV: 16-bit PCM, its rate and channels. */
function readWav(wav: Uint8Array) {
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
	if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('No es un WAV');
	let rate = 0;
	let channels = 0;
	let bits = 0;
	for (let at = 12; at + 8 <= wav.length;) {
		const size = view.getUint32(at + 4, true);
		const body = at + 8;
		if (tag(at) === 'fmt ') {
			channels = view.getUint16(body + 2, true);
			rate = view.getUint32(body + 4, true);
			bits = view.getUint16(body + 14, true);
		} else if (tag(at) === 'data') {
			if (bits !== 16 || !rate || !channels) throw new Error('WAV que no es PCM de 16 bits');
			// Piper streams it: its size may be left as the most there could be.
			return { rate, channels, data: wav.subarray(body, Math.min(wav.length, body + size)) };
		}
		at = body + size + (size % 2);
	}
	throw new Error('WAV sin datos');
}

function writeWav(rate: number, channels: number, data: Uint8Array) {
	const out = new Uint8Array(44 + data.length);
	const view = new DataView(out.buffer);
	const tag = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
	tag(0, 'RIFF');
	view.setUint32(4, 36 + data.length, true);
	tag(8, 'WAVE');
	tag(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * channels * 2, true);
	view.setUint16(32, channels * 2, true);
	view.setUint16(34, 16, true);
	tag(36, 'data');
	view.setUint32(40, data.length, true);
	out.set(data, 44);
	return out;
}

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
