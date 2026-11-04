import { describe, expect, test } from 'bun:test';
import { isLrc, lineAt, parseLyrics } from './lyrics.ts';

describe('lyrics', () => {
	test('LRC: times, repeated lines, the file’s tags left out, in order', () => {
		const lines = parseLyrics(
			'[ar:Queen]\n[ti:Bohemian Rhapsody]\n[00:12.50]Is this the real life?\n[00:16.00][01:10.0]Is this just fantasy?\n\n[00:20]'
		);
		expect(lines).toEqual([
			{ at: 12.5, text: 'Is this the real life?' },
			{ at: 16, text: 'Is this just fantasy?' },
			{ at: 20, text: '' },
			{ at: 70, text: 'Is this just fantasy?' }
		]);
	});

	test('the offset: the lines sooner', () => {
		expect(parseLyrics('[offset:+500]\n[00:10.00]Hola')).toEqual([{ at: 9.5, text: 'Hola' }]);
	});

	test('plain text: its lines, the verses kept, no times', () => {
		expect(isLrc('Uno\nDos')).toBe(false);
		expect(parseLyrics('\nUno\n\nDos\n\n')).toEqual([
			{ at: null, text: 'Uno' },
			{ at: null, text: '' },
			{ at: null, text: 'Dos' }
		]);
	});

	test('the line being sung', () => {
		const lines = parseLyrics('[00:05.00]A\n[00:10.00]B\n[00:15.00]C');
		expect([2, 5, 12, 99].map((s) => lineAt(lines, s))).toEqual([-1, 0, 1, 2]);
		expect(lineAt(parseLyrics('A\nB'), 30)).toBe(-1);
	});
});
