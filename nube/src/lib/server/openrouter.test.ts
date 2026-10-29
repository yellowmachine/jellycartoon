import { expect, test } from 'bun:test';
import { sayableError, toolChoiceRefused, usageOfStream } from './openrouter.ts';

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

test('a tool_choice no provider takes, told apart', () => {
	const refusal = {
		error: { message: "No endpoints found that support the provided 'tool_choice' value." }
	};
	expect(toolChoiceRefused(404, refusal)).toBe(true);
	expect(toolChoiceRefused(404, { error: { message: 'No endpoints found for model' } })).toBe(
		false
	);
	expect(toolChoiceRefused(400, refusal)).toBe(false);
});

test("OpenRouter's own words are not read aloud; ours are", () => {
	expect(
		sayableError("OpenRouter: No endpoints found that support the provided 'tool_choice' value")
	).toBe('La IA no ha podido contestar ahora. Prueba otra vez.');
	expect(sayableError('No queda saldo en OpenRouter')).toBe('No queda saldo en OpenRouter');
});
