import { expect, test } from 'bun:test';
import {
	dueMonths,
	lastDue,
	addMonths,
	byTag,
	euros,
	isDay,
	isFavorite,
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

test('a favourite is that expense, not any other at the same place', () => {
	const kebab = { text: 'Kebab', quantity: 1, amount: 500, tag: 'Otros' as LineTag };
	const fav = {
		id: 1,
		store: 'Kebab Ali',
		category: 'Restaurantes' as const,
		total: 500,
		lines: [kebab]
	};
	const same = { store: ' kebab ali', category: fav.category, total: 500, lines: [kebab] };
	expect(isFavorite(same, fav)).toBe(true);
	expect(isFavorite({ ...same, total: 1400 }, fav)).toBe(false);
	expect(isFavorite({ ...same, lines: [kebab, { ...kebab, text: 'Patatas' }] }, fav)).toBe(false);
	expect(isFavorite({ ...same, store: 'Otro' }, fav)).toBe(false);
	// Without an amount, any amount; lines without text, as if not there.
	expect(isFavorite({ ...same, total: 700 }, { ...fav, total: null })).toBe(true);
	expect(isFavorite({ ...same, lines: [kebab, { ...kebab, text: ' ' }] }, fav)).toBe(true);
});

test('lastDue: monthly, this month once its day comes; yearly, this year once its day comes', () => {
	expect(lastDue({ day: 15, month: null }, '2026-11-14')).toBe('2026-10');
	expect(lastDue({ day: 15, month: null }, '2026-11-15')).toBe('2026-11');
	expect(lastDue({ day: 1, month: null }, '2026-01-01')).toBe('2026-01');
	expect(lastDue({ day: 10, month: 3 }, '2026-11-01')).toBe('2026-03');
	expect(lastDue({ day: 10, month: 3 }, '2026-03-09')).toBe('2025-03');
	expect(lastDue({ day: 10, month: 12 }, '2026-11-01')).toBe('2025-12');
});

test('dueMonths: monthly, each one missed; yearly, only its month', () => {
	expect(dueMonths({ day: 5, month: null }, '2026-08', '2026-11-01')).toEqual([
		'2026-09',
		'2026-10'
	]);
	expect(dueMonths({ day: 1, month: null }, '2026-10', '2026-11-01')).toEqual(['2026-11']);
	expect(dueMonths({ day: 5, month: null }, null, '2026-11-01')).toEqual([]);
	expect(dueMonths({ day: 5, month: null }, null, '2026-11-05')).toEqual(['2026-11']);
	expect(dueMonths({ day: 10, month: 3 }, '2025-03', '2026-11-01')).toEqual(['2026-03']);
	expect(dueMonths({ day: 10, month: 3 }, '2026-03', '2026-11-01')).toEqual([]);
	expect(dueMonths({ day: 10, month: 3 }, '2026-03', '2027-03-10')).toEqual(['2027-03']);
	expect(dueMonths({ day: 10, month: 11 }, null, '2026-11-10')).toEqual(['2026-11']);
	expect(dueMonths({ day: 10, month: 3 }, '2024-03', '2026-11-01')).toEqual(['2025-03', '2026-03']);
});
