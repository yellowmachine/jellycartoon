/** Piper's WAVs as the satellites get them (#223): read, written back, and louder. */

/** Piper's WAV: 16-bit PCM, its rate and channels. */
export function readWav(wav: Uint8Array) {
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

export function writeWav(rate: number, channels: number, data: Uint8Array) {
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

/** Where the limiter starts to round the peaks off, of full scale. */
const KNEE = 0.8;

/**
 * Louder by `db`, the house's «Volumen de la voz» (Ajustes → Casa). The peaks that would go over
 * full scale are rounded off above `KNEE` (a soft limiter), not cut: a cut is heard as a crackle.
 */
export function louder(wav: Uint8Array<ArrayBuffer>, db: number) {
	if (!db) return wav;
	const { rate, channels, data } = readWav(wav);
	const gain = 10 ** (db / 20);
	const pcm = new Int16Array(
		data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1))
	);
	const out = Int16Array.from(pcm, (sample) => {
		const x = (sample / 32768) * gain;
		const abs = Math.abs(x);
		const y = abs <= KNEE ? abs : KNEE + (1 - KNEE) * Math.tanh((abs - KNEE) / (1 - KNEE));
		return Math.round(Math.sign(x) * y * 32767);
	});
	return writeWav(rate, channels, new Uint8Array(out.buffer));
}
