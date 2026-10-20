import { describe, expect, test } from 'bun:test';
import { goodLine, subtitleLines } from './quotes.ts';

const cue = (text: string) => ({ start: 0, end: 1, text });

describe('subtitleLines', () => {
	test('joins a sentence split across lines and cues', () => {
		expect(
			subtitleLines([cue('I am not saying\nthat you are wrong,'), cue('only that I am right.')])
		).toEqual(['I am not saying that you are wrong, only that I am right.']);
	});

	test('leaves out songs, sounds and two speakers', () => {
		expect(
			subtitleLines([
				cue('♪ Tossed salads and scrambled eggs ♪'),
				cue('[audience laughing]'),
				cue('- Hi, Niles.\n- Hello, Frasier.'),
				cue('Good evening, Seattle.')
			])
		).toEqual(['Good evening, Seattle.']);
	});

	test('a sound in the middle drops the half sentence before it', () => {
		expect(subtitleLines([cue('I was about to'), cue('(phone rings)'), cue('Hello?')])).toEqual([
			'Hello?'
		]);
	});
});

describe('goodLine', () => {
	test('a whole sentence of a readable length', () => {
		expect(goodLine('I have no idea what you are talking about.')).toBe(true);
		expect(goodLine('¿Y tú qué sabrás de ópera, si nunca has ido?')).toBe(true);
	});

	test('too short, too long, or not a whole sentence', () => {
		expect(goodLine('Yeah, right.')).toBe(false);
		expect(goodLine('and then he said that it was over.')).toBe(false);
		expect(goodLine('I have no idea what you are talking about')).toBe(false);
		expect(goodLine(`${'Very '.repeat(20)}long.`)).toBe(false);
	});
});
