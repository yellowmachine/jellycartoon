import { expect, mock, test } from 'bun:test';
import { cleanPageText, MAX_PAGE_TEXT, readPageText } from '#lib/wishes.ts';

// Only for analyzeWish itself, not tried here.
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	sayableError: (m: string) => m
}));
const { analysisFromAnswer, priceInText } = await import('./wish-analysis.ts');

/** «Analizar con IA» on a wish (#586): what is sent, and the answer checked against it. */

test('a price only if its number is in the text, with a currency of ours', () => {
	const text = 'Desde €58.54 · Size 55 cm\nAdd to Cart\n€ 1,084.20 · 499 kr';
	expect(priceInText('€1,084.20', text)).toBe('€1,084.20');
	expect(priceInText('58.54 EUR', text)).toBe('58.54 €');
	// Made up, or a piece of another number.
	expect(priceInText('€84.20', text)).toBeNull();
	expect(priceInText('€58', text)).toBeNull();
	expect(priceInText('499 kr', text)).toBeNull();
	expect(priceInText('', text)).toBeNull();
	expect(priceInText(84, text)).toBeNull();
});

test('the answer: what it does not say, missing', () => {
	expect(
		analysisFromAnswer(
			{ title: '  Composición  8 ', price: '84,20 €', options: '55 × 38,4 cm' },
			'Añadir 84,20 €'
		)
	).toEqual({ title: 'Composición 8', price: '84,20 €', options: '55 × 38,4 cm' });
	expect(analysisFromAnswer({ title: '', price: '9 €', options: 3 }, 'nada')).toEqual({
		title: null,
		price: null,
		options: null
	});
	expect(analysisFromAnswer(null, '')).toEqual({ title: null, price: null, options: null });
});

test('without e-mails or phones, and no longer than it may be', () => {
	const said = cleanPageText('Hola ana@casa.es, llama al +34 600 11 22 33.\nTalla 42 · 84,20 €');
	expect(said).not.toContain('ana@');
	expect(said).not.toContain('600');
	expect(said).toContain('Talla 42 · 84,20 €');
	expect(cleanPageText('x'.repeat(MAX_PAGE_TEXT * 2))).toHaveLength(MAX_PAGE_TEXT);
});

test('what the bookmark leaves after the #; anything else, null', () => {
	expect(readPageText(`#ia=${encodeURIComponent('Precios: 9 €')}`)).toBe('Precios: 9 €');
	expect(readPageText('#ia=%C0')).toBeNull();
	expect(readPageText('#ia=')).toBeNull();
	expect(readPageText('#otro')).toBeNull();
});
