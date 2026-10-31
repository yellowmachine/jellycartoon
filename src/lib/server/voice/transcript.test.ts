import { describe, expect, test } from 'bun:test';
import { cleanTranscript, whisperPrompt } from './transcript.ts';

describe('cleanTranscript', () => {
	test('the words, without the spaces and line break whisper leaves', () => {
		expect(cleanTranscript(' Pon algo de Alaska en el salón, por favor.\n')).toBe(
			'Pon algo de Alaska en el salón, por favor.'
		);
	});

	test('without its marks for silence and noise', () => {
		expect(cleanTranscript(' [BLANK_AUDIO]\n')).toBe('');
		expect(cleanTranscript('(música) Más alto, que no se oye. [risas]')).toBe(
			'Más alto, que no se oye.'
		);
	});
});

describe('whisperPrompt', () => {
	const library =
		'Órdenes de voz para la casa: pon música de Queen, Alaska y Dinarama, Franco Battiato.';

	test('without the family’s words, the library’s as they were', () => {
		expect(whisperPrompt(library, '  ', 600)).toBe(library);
	});

	test('the family’s last, as Whisper keeps the end', () => {
		expect(whisperPrompt(library, 'Vélez-Rubio, Ana,  Lucía', 600)).toBe(
			`${library} En casa: Vélez-Rubio, Ana, Lucía.`
		);
		expect(whisperPrompt('', 'Vélez-Rubio', 600)).toBe('En casa: Vélez-Rubio.');
	});

	test('no room: the library’s cut by whole names, the family’s whole', () => {
		const prompt = whisperPrompt(library, 'Vélez-Rubio, Ana', 90);
		expect(prompt.length).toBeLessThanOrEqual(90);
		expect(prompt).toBe(
			'Órdenes de voz para la casa: pon música de Queen. En casa: Vélez-Rubio, Ana.'
		);
	});
});
