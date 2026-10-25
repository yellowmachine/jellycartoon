import { expect, test } from 'bun:test';
import { draftFromAnswer } from './receipt-parse.ts';

const TODAY = '2026-10-25';

test("the model's answer, in cents", () => {
	expect(
		draftFromAnswer(
			{
				store: 'Mercadona',
				date: '2026-10-24',
				total: 32.19,
				category: 'Supermercado',
				lines: [
					{ text: '1 LECHE ENTERA 6X1L', quantity: 1, amount: 6.12 },
					{ text: '0,612 kg PLATANO', quantity: 0.612, amount: 1.22 },
					{ text: 'DESCUENTO', quantity: 0, amount: -0.5 }
				]
			},
			TODAY
		)
	).toEqual({
		date: '2026-10-24',
		store: 'Mercadona',
		category: 'Supermercado',
		total: 3219,
		lines: [
			{ text: '1 LECHE ENTERA 6X1L', quantity: 1, amount: 612 },
			{ text: '0,612 kg PLATANO', quantity: 0.612, amount: 122 },
			{ text: 'DESCUENTO', quantity: null, amount: -50 }
		]
	});
});

test('what it could not read: guessed, to correct', () => {
	expect(
		draftFromAnswer(
			{
				store: '  ',
				date: '2027-01-01',
				total: 0,
				category: 'Caprichos',
				lines: [
					{ text: 'PAN', quantity: 2, amount: 1.3 },
					{ text: '', quantity: 1, amount: 3 },
					{ text: 'ZUMO', quantity: 1, amount: 'mucho' }
				]
			},
			TODAY
		)
	).toEqual({
		date: TODAY,
		store: '',
		category: 'Otros',
		total: 130,
		lines: [{ text: 'PAN', quantity: 2, amount: 130 }]
	});
	expect(draftFromAnswer(null, TODAY)).toEqual({
		date: TODAY,
		store: '',
		category: 'Otros',
		total: 0,
		lines: []
	});
});
