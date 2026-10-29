import { expect, test } from 'bun:test';
import { usageOfStream } from './openrouter.ts';

test('the usage of a streamed answer, in its last event', () => {
	const stream = [
		': OPENROUTER PROCESSING',
		'data: {"choices":[{"delta":{"content":"Ho"}}]}',
		'data: {"choices":[{"delta":{"content":"la"}}]}',
		'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2,"cost":0.00012}}',
		'data: [DONE]',
		''
	].join('\n\n');
	expect(usageOfStream(stream)?.cost).toBe(0.00012);
});

test('none if it never came', () =>
	expect(usageOfStream('data: {"choices":[]}\n\ndata: [DONE]\n\n')).toBeUndefined());
