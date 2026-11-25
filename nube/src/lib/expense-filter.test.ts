import { expect, test } from 'bun:test';
import type { Expense, OwnTags } from 'comun/expenses.ts';
import { filterExpenses, isFiltered, noFilter } from './expense-filter.ts';

const own: OwnTags = { tags: [], rules: {} };
const e = (id: number, date: string, store: string, total: number, line = ''): Expense => ({
	id,
	date,
	store,
	category: 'Supermercado',
	total,
	source: 'ticket',
	by: 'Ana',
	foreign: null,
	hasReceipt: false,
	fixed: false,
	bill: null,
	lines: line ? [{ text: line, quantity: 1, amount: total, tag: 'Fruta y verdura' }] : []
});
const list = [
	e(1, '2026-11-20', 'Mercadona', 2345, 'Plátano de Canarias'),
	e(2, '2026-11-20', 'MERCADONA ', 123456),
	e(3, '2026-11-18', 'IberLibro', 1811, 'El nombre de la rosa')
];
const ids = (f: Partial<ReturnType<typeof noFilter>>) =>
	filterExpenses(list, { ...noFilter(), ...f }, own).map((x) => x.id);

test('by words: shop, product without accents, amount, all of them', () => {
	expect(ids({ text: 'mercadona' })).toEqual([1, 2]);
	expect(ids({ text: 'PLATANO' })).toEqual([1]);
	expect(ids({ text: 'mercadona plátano' })).toEqual([1]);
	expect(ids({ text: 'rosa mercadona' })).toEqual([]);
	expect(ids({ text: '18,11' })).toEqual([3]);
	expect(ids({ text: '1234,56' })).toEqual([2]);
	expect(ids({ text: 'fruta' })).toEqual([1, 3]);
	expect(ids({ text: '  ' })).toEqual([1, 2, 3]);
});

test('by day and by shop, however it was written; together', () => {
	expect(ids({ day: '2026-11-20' })).toEqual([1, 2]);
	expect(ids({ store: 'mercadona' })).toEqual([1, 2]);
	expect(ids({ store: 'mercadona', day: '2026-11-18' })).toEqual([]);
	expect(isFiltered(noFilter())).toBe(false);
	expect(isFiltered({ ...noFilter(), day: '2026-11-20' })).toBe(true);
});
