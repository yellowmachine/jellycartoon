import { expect, test } from 'bun:test';
import { whisperLanguage } from './languages.ts';

test('whisperLanguage: two letters for Whisper, auto when unknown', () => {
	expect(whisperLanguage('eng')).toBe('en');
	expect(whisperLanguage('spa')).toBe('es');
	expect(whisperLanguage('fra')).toBe('fr');
	expect(whisperLanguage('deu')).toBe('de');
	expect(whisperLanguage('und')).toBe('auto');
	expect(whisperLanguage(null)).toBe('auto');
	expect(whisperLanguage('kor')).toBe('auto');
});
