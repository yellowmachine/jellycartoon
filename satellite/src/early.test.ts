import { describe, expect, test } from 'bun:test';
import { EarlyHearing } from './early.ts';

const WAV = new Uint8Array([1, 2, 3]);

function hearing(afterMs: number, answer: () => Promise<string | null> = async () => 'hola') {
	const sent: { wav: Uint8Array; signal: AbortSignal }[] = [];
	const early = new EarlyHearing(afterMs, (wav, signal) => {
		sent.push({ wav, signal });
		return answer();
	});
	return { early, sent };
}

describe('the order heard before its silence ends', () => {
	test('sent once, after the moment of quiet', async () => {
		const { early, sent } = hearing(300);
		early.update(0, () => WAV);
		early.update(288, () => WAV);
		expect(sent).toHaveLength(0);
		early.update(320, () => WAV);
		early.update(352, () => WAV);
		expect(sent).toHaveLength(1);
		expect(await early.heard).toBe('hola');
	});

	test('the voice back: aborted, and sent again at the next quiet', () => {
		const { early, sent } = hearing(300);
		early.update(320, () => WAV);
		expect(early.update(0, () => WAV)).toBe(true);
		expect(sent[0]!.signal.aborted).toBe(true);
		expect(early.heard).toBeNull();
		expect(early.update(0, () => WAV)).toBe(false);
		early.update(320, () => WAV);
		expect(sent).toHaveLength(2);
		expect(sent[1]!.signal.aborted).toBe(false);
	});

	test('a failure is no text, not an error', async () => {
		const { early } = hearing(300, () => Promise.reject(new Error('no')));
		early.update(320, () => WAV);
		expect(await early.heard).toBeNull();
	});

	test('off with 0', () => {
		const { early, sent } = hearing(0);
		early.update(5000, () => WAV);
		expect(sent).toHaveLength(0);
		expect(early.heard).toBeNull();
	});
});
