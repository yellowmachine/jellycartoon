import { expect, test } from 'bun:test';
import { linkOrder } from './shared-link.ts';

test('the likeliest first: a podcast, a recipe, a product, else a note to read later', () => {
	const is = { wish: false, recipe: false, podcast: false, canWish: true, canNote: true };
	expect(linkOrder({ ...is, podcast: true })).toEqual(['podcast', 'receta', 'deseos', 'notas']);
	expect(linkOrder({ ...is, recipe: true })).toEqual(['receta', 'deseos', 'notas']);
	expect(linkOrder({ ...is, wish: true })).toEqual(['deseos', 'receta', 'notas']);
	expect(linkOrder(is)).toEqual(['notas', 'receta', 'deseos']);
	// A child: no Notas; no list to write in, no wishes.
	expect(linkOrder({ ...is, canNote: false, canWish: false })).toEqual(['receta']);
});
