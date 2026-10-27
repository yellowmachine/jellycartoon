import { describe, expect, test } from 'bun:test';
import { chime, withChime } from './chime.ts';

function wav(rate: number, samples: number[]) {
	const data = new Int16Array(samples);
	const out = new Uint8Array(44 + data.byteLength);
	const view = new DataView(out.buffer);
	out.set(new TextEncoder().encode('RIFF'), 0);
	view.setUint32(4, 36 + data.byteLength, true);
	out.set(new TextEncoder().encode('WAVEfmt '), 8);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	out.set(new TextEncoder().encode('data'), 36);
	view.setUint32(40, data.byteLength, true);
	out.set(new Uint8Array(data.buffer), 44);
	return out;
}

describe('withChime', () => {
	test('the chime, then the voice as it was, at its rate', () => {
		const voice = [1000, -1000, 2000];
		const out = withChime(wav(22050, voice));
		const view = new DataView(out.buffer);
		expect(view.getUint32(24, true)).toBe(22050);
		const before = chime(22050).length;
		expect(view.getUint32(40, true)).toBe((before + voice.length) * 2);
		const pcm = new Int16Array(out.buffer.slice(44));
		expect([...pcm.slice(before)]).toEqual(voice);
		// It sounds: not silence.
		expect(Math.max(...pcm.slice(0, before).map(Math.abs))).toBeGreaterThan(5000);
	});

	test('not a WAV', () => {
		expect(() => withChime(new Uint8Array(50))).toThrow();
	});
});
