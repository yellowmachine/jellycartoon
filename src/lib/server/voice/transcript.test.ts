import { describe, expect, test } from 'bun:test';
import { cleanTranscript } from './transcript.ts';

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
