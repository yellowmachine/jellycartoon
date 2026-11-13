import { describe, expect, test } from 'bun:test';
import { boughtOf } from './bought.ts';

describe('boughtOf (#451)', () => {
	test('each line with its tag, once, without discounts', () => {
		const bought = boughtOf(7, {
			date: '2026-11-09',
			store: 'Mercadona',
			category: 'Supermercado',
			total: 500,
			lines: [
				{ text: 'COCA COLA Z 2L', quantity: 1, amount: 210, tag: 'Bebidas' },
				{ text: 'COCA COLA Z 2L', quantity: 1, amount: 210, tag: 'Bebidas' },
				{ text: 'DTO. 2ª UD', quantity: null, amount: -50, tag: 'Otros' },
				{ text: 'PAN BARRA', quantity: 1, amount: 130, tag: 'Panadería' }
			]
		});
		expect(bought).toEqual({
			expenseId: 7,
			items: ['COCA COLA Z 2L (Bebidas)', 'PAN BARRA (Panadería)']
		});
	});

	test('no lines (by voice): what it was', () => {
		const bought = boughtOf(8, {
			date: '2026-11-09',
			store: 'cerveza',
			category: 'Supermercado',
			total: 800,
			lines: []
		});
		expect(bought.items).toEqual(['cerveza']);
	});
});
