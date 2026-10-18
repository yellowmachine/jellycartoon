import { expect, test } from 'bun:test';
import { assumeLanguage, whisperLanguage } from './languages.ts';

test('whisperLanguage: two letters for Whisper, auto when unknown', () => {
	expect(whisperLanguage('eng')).toBe('en');
	expect(whisperLanguage('spa')).toBe('es');
	expect(whisperLanguage('fra')).toBe('fr');
	expect(whisperLanguage('deu')).toBe('de');
	expect(whisperLanguage('und')).toBe('auto');
	expect(whisperLanguage(null)).toBe('auto');
	expect(whisperLanguage('kor')).toBe('auto');
});

test('assumeLanguage: only unknown or assumed tracks, and back to unknown', () => {
	const tracks = [
		{ lang: 'und', label: 'Desconocido' },
		{ lang: 'spa', label: 'Español' }
	];
	const english = assumeLanguage(tracks, 'eng');
	expect(english).toEqual([
		{ lang: 'eng', label: 'English', assumed: true },
		{ lang: 'spa', label: 'Español' }
	]);
	expect(assumeLanguage(english, 'fre')[0]).toEqual({
		lang: 'fre',
		label: 'Français',
		assumed: true
	});
	expect(assumeLanguage(english, null)).toEqual(tracks);
});
