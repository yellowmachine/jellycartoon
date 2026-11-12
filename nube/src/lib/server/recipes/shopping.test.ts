import { expect, test } from 'bun:test';
import { plainShopping, shoppingFromAi } from './shopping-items.ts';

/** «Añadir a la compra» in a recipe: what the AI answers, checked; and without it. */

test('the AI answer becomes the card way: name and amount in brackets, usual kept', () => {
	expect(
		shoppingFromAi({
			items: [
				{ name: ' Harina de trigo ', amount: '200 g', usual: false },
				{ name: 'Huevos', amount: '2', usual: false },
				{ name: 'Sal', amount: null, usual: true },
				{ name: 'Pimienta', amount: '  ', usual: true }
			]
		})
	).toEqual([
		{ item: 'Harina de trigo (200 g)', usual: false },
		{ item: 'Huevos (2)', usual: false },
		{ item: 'Sal', usual: true },
		{ item: 'Pimienta', usual: true }
	]);
});

test('empty names, repeats and odd values are left out; usual only when true', () => {
	expect(
		shoppingFromAi({
			items: [
				{ name: '', amount: '1', usual: false },
				{ name: 'Leche', amount: '1 l', usual: 'sí' },
				{ name: 'leche', amount: '1 L', usual: false },
				null,
				{ name: 3 }
			]
		})
	).toEqual([{ item: 'Leche (1 l)', usual: false }]);
});

test('an answer with nothing usable is null, so the plain ingredients go instead', () => {
	expect(shoppingFromAi(null)).toBeNull();
	expect(shoppingFromAi({ items: 'harina' })).toBeNull();
	expect(shoppingFromAi({ items: [{ name: ' ' }] })).toBeNull();
});

test('a very long list is cut, and each item to the list’s length', () => {
	const many = shoppingFromAi({
		items: Array.from({ length: 80 }, (_, i) => ({ name: `Cosa ${i}`, amount: null, usual: false }))
	});
	expect(many).toHaveLength(60);
	const [long] = shoppingFromAi({ items: [{ name: 'x'.repeat(500), amount: null }] })!;
	expect(long.item.length).toBeLessThan(500);
});

test('without the AI, the ingredients as written, none usual', () => {
	expect(plainShopping([' 200 g de harina ', '', '2 huevos'])).toEqual([
		{ item: '200 g de harina', usual: false },
		{ item: '2 huevos', usual: false }
	]);
});
