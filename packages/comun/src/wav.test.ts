import { describe, expect, test } from 'bun:test';
import { louder, readWav, writeWav } from './wav.ts';

const wav = (samples: number[]) =>
	writeWav(22050, 1, new Uint8Array(new Int16Array(samples).buffer));
const samples = (out: Uint8Array) => {
	const { data } = readWav(out);
	return [...new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))];
};

describe('louder', () => {
	test('quiet samples, by the gain', () => {
		expect(samples(louder(wav([1000, -1000]), 6))).toEqual([1995, -1995]);
	});

	test('the peaks rounded off under full scale, not cut', () => {
		const [a, b] = samples(louder(wav([30000, 20000]), 3));
		expect(a).toBeLessThanOrEqual(32767);
		expect(a).toBeGreaterThan(b!);
	});

	test('0 dB, the same', () => {
		const same = wav([5, 6]);
		expect(louder(same, 0)).toBe(same);
	});
});
