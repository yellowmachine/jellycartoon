import { describe, expect, test } from 'bun:test';
import { answerLanguage, hearingLanguage, heardLanguages, saidIn } from './satellite-language.ts';

describe('idiomas del satélite (#647)', () => {
	test('sin nada guardado, o con basura, español', () => {
		expect(heardLanguages(null)).toEqual(['es']);
		expect(heardLanguages(['de', 7])).toEqual(['es']);
		expect(heardLanguages(['fr', 'es', 'fr'])).toEqual(['es', 'fr']);
	});

	test('con un solo idioma, contesta en ese y se oye en ese', () => {
		expect(answerLanguage('auto', ['en'])).toBe('en');
		expect(answerLanguage('es', ['en'])).toBe('en');
		expect(hearingLanguage(['en'])).toBe('en');
	});

	test('con varios, se adivina al oír; contesta en uno de ellos o como le hablen', () => {
		expect(hearingLanguage(['es', 'en'])).toBeNull();
		expect(answerLanguage('en', ['es', 'en'])).toBe('en');
		expect(answerLanguage('fr', ['es', 'en'])).toBe('auto');
		expect(answerLanguage('auto', ['es', 'en'])).toBe('auto');
	});

	test('en español, lo de siempre', () => {
		expect(saidIn('es')).toBe('en español');
		expect(saidIn('en')).toContain('in English');
	});
});
