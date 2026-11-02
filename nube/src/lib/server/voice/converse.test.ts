import { expect, test } from 'bun:test';
import { conversationLines, CONVERSE_SYSTEM } from './converse.ts';

test('what was said before, as lines: who said it, the last ones only', () => {
	const history = Array.from({ length: 20 }, (_, i) => ({
		role: i % 2 ? ('assistant' as const) : ('user' as const),
		content: `frase ${i}`
	}));
	const lines = conversationLines(history).split('\n');
	expect(lines).toHaveLength(12);
	expect(lines[0]).toBe('Persona: frase 8');
	expect(lines.at(-1)).toBe('Tú: frase 19');
	expect(conversationLines([])).toBe('');
});

test('spoken, in a few sentences', () => {
	expect(CONVERSE_SYSTEM).toContain('4 a 6 frases');
	expect(CONVERSE_SYSTEM).toContain('sin listas');
});
