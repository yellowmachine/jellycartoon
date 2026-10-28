import { expect, test } from 'bun:test';
import {
	addMonths,
	byTag,
	euros,
	isDay,
	parseEuros,
	parseExpenseInput,
	UNTAGGED,
	type LineTag
} from './expenses.ts';

test('amounts as written in Spain, and as the keyboard gives them', () => {
	expect(parseEuros('12,30')).toBe(1230);
	expect(parseEuros('12.30')).toBe(1230);
	expect(parseEuros('12')).toBe(1200);
	expect(parseEuros('1.234,50 €')).toBe(123450);
	expect(parseEuros('0,6')).toBe(60);
	expect(parseEuros('-1,20')).toBe(-120);
	expect(parseEuros('')).toBeNull();
	expect(parseEuros('doce')).toBeNull();
	expect(parseEuros('1,234')).toBeNull();
});

test('euros, with a decimal comma', () => {
	expect(euros(3219).replace(/\s/g, ' ')).toBe('32,19 €');
	expect(euros(5).replace(/\s/g, ' ')).toBe('0,05 €');
});

test('real days only', () => {
	expect(isDay('2026-10-25')).toBe(true);
	expect(isDay('2026-02-30')).toBe(false);
	expect(isDay('25/10/2026')).toBe(false);
});

test('months, across years', () => {
	expect(addMonths('2026-01', -1)).toBe('2025-12');
	expect(addMonths('2026-12', 1)).toBe('2027-01');
});

test('what a page sends: well formed, empty lines out', () => {
	const ok = {
		date: '2026-10-25',
		store: ' Mercadona ',
		category: 'Supermercado',
		total: 3219,
		lines: [
			{ text: 'LECHE', quantity: 1, amount: 612, tag: 'Lácteos y huevos' },
			{ text: '  ', quantity: null, amount: 0 },
			{ text: 'PLATANO', quantity: 0.612, amount: 122 }
		]
	};
	expect(parseExpenseInput(ok)).toEqual({
		date: '2026-10-25',
		store: 'Mercadona',
		category: 'Supermercado',
		total: 3219,
		lines: [
			{ text: 'LECHE', quantity: 1, amount: 612, tag: 'Lácteos y huevos' },
			{ text: 'PLATANO', quantity: 0.612, amount: 122, tag: 'Otros' }
		]
	});
	expect(parseExpenseInput({ ...ok, category: 'Caprichos' })).toBeNull();
	expect(parseExpenseInput({ ...ok, total: 32.19 })).toBeNull();
	expect(parseExpenseInput({ ...ok, date: '2026-13-01' })).toBeNull();
	expect(parseExpenseInput({ ...ok, store: '' })).toBeNull();
});

test("a category by its lines' tags, what they miss apart and last", () => {
	const line = (tag: LineTag, amount: number) => ({ text: tag, quantity: 1, amount, tag });
	const receipt = {
		date: '2026-10-25',
		store: 'Coaliment',
		category: 'Supermercado' as const,
		total: 840,
		lines: [
			line('Bebidas', 37),
			line('Bebidas', 89),
			line('Higiene', 179),
			line('Carne y pescado', 327)
		]
	};
	expect(byTag([receipt, { ...receipt, total: 1500, lines: [] }])).toEqual([
		{ tag: 'Carne y pescado', total: 327 },
		{ tag: 'Higiene', total: 179 },
		{ tag: 'Bebidas', total: 126 },
		{ tag: UNTAGGED, total: 1708 }
	]);
	expect(byTag([{ ...receipt, total: 632 }])).toHaveLength(3);
});
