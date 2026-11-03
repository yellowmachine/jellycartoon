import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_FILLERS,
	DEFAULT_GREETINGS,
	MAX_FILLER_CHARS,
	parseFillers,
	pickFiller
} from './ai-voice.ts';

describe('parseFillers', () => {
	test('one a line, trimmed, without empty lines or repeats', () => {
		expect(parseFillers(' Vale. \n\nUn momento.\nVale.\n')).toEqual(['Vale.', 'Un momento.']);
	});

	test('nothing saved: the default ones, unless asked not to', () => {
		expect(parseFillers(null)).toEqual(DEFAULT_FILLERS);
		expect(parseFillers('  \n ')).toEqual(DEFAULT_FILLERS);
		expect(parseFillers('\n', { orDefault: false })).toEqual([]);
	});

	test('the greetings, with their own default ones', () => {
		expect(parseFillers('', { defaults: DEFAULT_GREETINGS })).toEqual(DEFAULT_GREETINGS);
		expect(parseFillers('¿Qué tal?', { defaults: DEFAULT_GREETINGS })).toEqual(['¿Qué tal?']);
	});

	test('a long line cut', () => {
		expect(parseFillers('a'.repeat(200))[0]).toHaveLength(MAX_FILLER_CHARS);
	});
});

describe('pickFiller', () => {
	test('never the last one when there are more', () => {
		for (const r of [0, 0.5, 0.99]) expect(pickFiller(['A', 'B'], 'A', () => r)).toBe('B');
	});

	test('the only one, even if it was the last', () => {
		expect(pickFiller(['A'], 'A')).toBe('A');
	});

	test('none', () => {
		expect(pickFiller([], null)).toBeNull();
	});
});
