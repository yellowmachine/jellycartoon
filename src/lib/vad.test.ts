import { describe, expect, test } from 'bun:test';
import { SpeechEnd, VAD_FRAME, Vad, type VadRun } from './vad.ts';

/** Frames of 32 ms with `p`, for `ms`; what the last said. */
function feed(end: SpeechEnd, p: number, ms: number) {
	let said: ReturnType<SpeechEnd['frame']> = 'listening';
	for (let t = 0; t < ms; t += 32) said = end.frame(p);
	return said;
}

describe('SpeechEnd', () => {
	test('spoken, then quiet: over after the silence', () => {
		const end = new SpeechEnd();
		expect(feed(end, 0.9, 1500)).toBe('listening');
		expect(feed(end, 0.05, 1000)).toBe('listening');
		expect(feed(end, 0.05, 300)).toBe('done');
	});

	test('a pause shorter than the silence, and more speech: still listening', () => {
		const end = new SpeechEnd();
		feed(end, 0.9, 800);
		feed(end, 0.05, 900);
		feed(end, 0.9, 800);
		expect(feed(end, 0.05, 1000)).toBe('listening');
	});

	test('between the two thresholds, neither speech nor silence', () => {
		const end = new SpeechEnd();
		feed(end, 0.9, 800);
		expect(feed(end, 0.4, 3000)).toBe('listening');
	});

	test('nothing said: given up after the wait', () => {
		const end = new SpeechEnd();
		expect(feed(end, 0.05, 4900)).toBe('listening');
		expect(feed(end, 0.05, 200)).toBe('nothing');
	});

	test('a short noise is not speech', () => {
		const end = new SpeechEnd();
		feed(end, 0.9, 100);
		expect(feed(end, 0.05, 1300)).toBe('listening');
		expect(feed(end, 0.05, 4000)).toBe('nothing');
	});

	test('speaking past the wait is fine', () => {
		const end = new SpeechEnd();
		expect(feed(end, 0.9, 7000)).toBe('listening');
		expect(feed(end, 0.05, 1300)).toBe('done');
	});
});

describe('Vad', () => {
	test('frames of 512 with the 64 samples before, the state carried, −1…1', async () => {
		const calls: { input: Float32Array; state: Float32Array }[] = [];
		const run: VadRun = async (input, state) => {
			calls.push({ input, state });
			return { probability: 0.7, state: new Float32Array(256).fill(calls.length) };
		};
		const vad = new Vad(run);
		const samples = Float32Array.from({ length: VAD_FRAME + 100 }, (_, i) => (i % 2 ? 16384 : 0));
		expect(await vad.push(samples)).toEqual([0.7]);
		expect(await vad.push(new Float32Array(VAD_FRAME - 100))).toEqual([0.7]);
		expect(calls).toHaveLength(2);
		expect(calls[0]!.input).toHaveLength(64 + VAD_FRAME);
		expect(calls[0]!.input.slice(0, 64).every((x) => x === 0)).toBe(true);
		expect(calls[0]!.input[64 + 1]).toBe(0.5);
		// The second frame starts with the end of the first.
		expect(calls[1]!.input.slice(0, 64)).toEqual(calls[0]!.input.slice(-64));
		expect(calls[1]!.state[0]).toBe(1);
	});
});
