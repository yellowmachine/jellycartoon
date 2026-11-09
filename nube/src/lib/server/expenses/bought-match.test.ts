import { describe, expect, test } from 'bun:test';
import { askedPrompt, byWords, fromAnswer } from './bought-match.ts';

const list = [
	{ id: 1, text: 'tomates' },
	{ id: 2, text: 'leche' },
	{ id: 3, text: 'papel de cocina' },
	{ id: 4, text: 'pilas' }
];
const lines = [
	'TOMATE PERA (Fruta y verdura)',
	'LECHE SEMI PASCUAL (Lácteos y huevos)',
	'ROLLO COCINA RENOVA (Limpieza)'
];

describe('tachar lo comprado (#451, fase 2)', () => {
	test('by its words: plural, case and accents aside', () => {
		expect(byWords(list, lines).map((i) => i.text)).toEqual(['tomates', 'leche']);
	});

	test('the question numbers the list as it is asked', () => {
		const prompt = askedPrompt(list.slice(2), lines);
		expect(prompt).toContain('1. papel de cocina\n2. pilas');
		expect(prompt).toContain('ROLLO COCINA RENOVA (Limpieza)');
	});

	test('the answer: only numbers the list has, once each', () => {
		const rest = list.slice(2);
		expect(fromAnswer(rest, { vienen: [1, 1, 7, 0, 'x'] }).map((i) => i.id)).toEqual([3]);
		expect(fromAnswer(rest, null)).toEqual([]);
	});
});
