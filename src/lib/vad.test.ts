import { describe, expect, test } from 'bun:test';
import { SPEECH_END, SpeechEnd, VAD_FRAME, Vad, type VadRun } from './vad.ts';

/** Frames of 32 ms with `p` (and level `dbfs`), for `ms`; what the last said. */
function feed(end: SpeechEnd, p: number, ms: number, dbfs?: number) {
	let said: ReturnType<SpeechEnd['frame']> = 'listening';
	for (let t = 0; t < ms; t += 32) said = end.frame(p, dbfs);
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

	test('a TV talking on: over all the same, 8 s after starting to speak', () => {
		const end = new SpeechEnd();
		feed(end, 0.05, 2000);
		expect(feed(end, 0.9, 7900)).toBe('listening');
		expect(feed(end, 0.9, 200)).toBe('done');
		expect(end.report.capped).toBe(true);
	});

	test('a TV much quieter than the word: silence, over after the order', () => {
		const end = new SpeechEnd(SPEECH_END, -20);
		feed(end, 0.9, 1500, -24);
		expect(feed(end, 0.9, 1000, -45)).toBe('listening');
		expect(feed(end, 0.9, 300, -45)).toBe('done');
		const { voiceDb, backgroundDb, backgroundMs, capped } = end.report;
		expect({ voiceDb, backgroundDb, capped }).toEqual({
			voiceDb: -20,
			backgroundDb: -45,
			capped: false
		});
		expect(backgroundMs).toBeGreaterThanOrEqual(1200);
	});

	test('the TV before the order is not the voice, nor the order', () => {
		const end = new SpeechEnd(SPEECH_END, -20);
		expect(feed(end, 0.9, 4900, -45)).toBe('listening');
		expect(feed(end, 0.9, 200, -45)).toBe('nothing');
	});

	test('quieter syllables within the margin are still the order', () => {
		const end = new SpeechEnd(SPEECH_END, -20);
		feed(end, 0.9, 1000, -22);
		expect(feed(end, 0.9, 2000, -32)).toBe('listening');
		expect(end.report.backgroundDb).toBeNull();
	});

	test('after a tap, the first speech sets the voice', () => {
		const end = new SpeechEnd();
		feed(end, 0.9, 300, -30);
		feed(end, 0.9, 300, -18);
		feed(end, 0.9, 500, -25);
		expect(feed(end, 0.9, 1300, -40)).toBe('done');
		expect(end.report.voiceDb).toBe(-18);
	});

	test('without levels, all speech counts', () => {
		const end = new SpeechEnd(SPEECH_END, -20);
		feed(end, 0.9, 800);
		expect(feed(end, 0.9, 3000)).toBe('listening');
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
		const [first] = await vad.push(samples);
		expect(first!.probability).toBe(0.7);
		// Half the samples at 0.5: a power of 1/8.
		expect(first!.dbfs).toBeCloseTo(10 * Math.log10(1 / 8));
		expect(await vad.push(new Float32Array(VAD_FRAME - 100))).toHaveLength(1);
		expect(calls).toHaveLength(2);
		expect(calls[0]!.input).toHaveLength(64 + VAD_FRAME);
		expect(calls[0]!.input.slice(0, 64).every((x) => x === 0)).toBe(true);
		expect(calls[0]!.input[64 + 1]).toBe(0.5);
		// The second frame starts with the end of the first.
		expect(calls[1]!.input.slice(0, 64)).toEqual(calls[0]!.input.slice(-64));
		expect(calls[1]!.state[0]).toBe(1);
	});
});
