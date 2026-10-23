import { describe, expect, test } from 'bun:test';
import { CHUNK, WakeWordDetector, type Run } from './wakeword.ts';

/**
 * A stand-in for ONNX Runtime: what each model gets, and outputs of the right size (8 melspectrogram
 * frames per 80 ms, as the real model gives). The real models were checked against openWakeWord in
 * Python on the same audio: the same scores, chunk by chunk.
 */
function fake(score = 0.9) {
	const calls: { model: string; length: number; dims: number[] }[] = [];
	const run: Run = async (model, input, dims) => {
		calls.push({ model, length: input.length, dims });
		if (model === 'melspectrogram') {
			const frames = Math.floor((input.length - 400) / 160) + 1 - 2;
			return new Float32Array(Math.max(frames, 0) * 32);
		}
		if (model === 'embedding') return new Float32Array(96);
		return new Float32Array([score]);
	};
	return { run, calls };
}

describe('WakeWordDetector', () => {
	test('a chunk of 80 ms, the next with 480 samples before it', async () => {
		const { run, calls } = fake();
		const det = new WakeWordDetector(run, [{ name: 'hola', frames: 16 }]);
		await det.warmUp();
		calls.length = 0;
		expect(await det.push(new Float32Array(CHUNK - 1))).toEqual([]);
		expect(await det.push(new Float32Array(1 + CHUNK))).toHaveLength(2);
		const mels = calls.filter((c) => c.model === 'melspectrogram').map((c) => c.length);
		expect(mels).toEqual([CHUNK, CHUNK + 480]);
		const embedding = calls.find((c) => c.model === 'embedding')!;
		expect(embedding.dims).toEqual([1, 76, 32, 1]);
	});

	test('nothing for the first five, then the model on the last 16 embeddings', async () => {
		const { run, calls } = fake(0.5);
		const det = new WakeWordDetector(run, [{ name: 'hola', frames: 16 }]);
		await det.warmUp();
		const scores = await det.push(new Float32Array(CHUNK * 7));
		expect(scores.map((s) => s[0])).toEqual([0, 0, 0, 0, 0, 0.5, 0.5]);
		const model = calls.filter((c) => c.model === 'hola');
		expect(model).toHaveLength(2);
		expect(model[0]!.dims).toEqual([1, 16, 96]);
	});
});
