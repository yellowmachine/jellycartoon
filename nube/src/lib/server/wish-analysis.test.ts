import { expect, mock, test } from 'bun:test';
import { cleanPageText, MAX_PAGE_TEXT, readPageText } from '#lib/wishes.ts';

// Only for analyzeWish itself, not tried here.
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	sayableError: (m: string) => m
}));
const { analysisFromAnswer, priceInText, shippingInText } = await import('./wish-analysis.ts');

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
	).toEqual({ title: 'Composición 8', price: '84,20 €', shipping: null, options: '55 × 38,4 cm' });
	expect(analysisFromAnswer({ title: '', price: '9 €', options: 3 }, 'nada')).toEqual({
		title: null,
		price: null,
		shipping: null,
		options: null
	});
	expect(analysisFromAnswer(null, '')).toEqual({
		title: null,
		price: null,
		shipping: null,
		options: null
	});
});

test('its shipping, checked too: in the text, and in the price’s currency', () => {
	const text = 'Precio 5,22 €\nGastos de envío: 12,19 €\n£4.00';
	expect(shippingInText('12,19 €', text)).toBe('12,19 €');
	expect(shippingInText('9 €', text)).toBeNull();
	expect(shippingInText('gratis', text)).toBeNull();
	expect(shippingInText('gratis', 'Envío a domicilio gratis')).toBe('gratis');
	expect(shippingInText('0 €', 'Envío: 0,00 €')).toBe('gratis');
	expect(analysisFromAnswer({ price: '5,22 €', shipping: '£4.00' }, text)).toMatchObject({
		price: '5,22 €',
		shipping: null
	});
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
