import { expect, test } from 'bun:test';
import { UNTAGGED } from '#lib/expenses.ts';
import { analyse, type MonthSum } from './analysis-sums.ts';

const CURRENT = '2026-10';

const byCategory: MonthSum[] = [
	{ month: '2026-07', category: 'Supermercado', total: 30000 },
	{ month: '2026-08', category: 'Supermercado', total: 30000 },
	{ month: '2026-09', category: 'Supermercado', total: 30000 },
	{ month: '2026-07', category: 'Gasolina', total: 9000 },
	{ month: '2026-08', category: 'Gasolina', total: 9000 },
	{ month: '2026-09', category: 'Gasolina', total: 9000 },
	{ month: '2026-10', category: 'Supermercado', total: 20000 },
	{ month: '2026-10', category: 'Gasolina', total: 9500 },
	{ month: '2026-10', category: 'Viajes', total: 15000 }
];
const byTag: MonthSum[] = [
	{ month: '2026-07', category: 'Supermercado', tag: 'Carne y pescado', total: 6000 },
	{ month: '2026-08', category: 'Supermercado', tag: 'Carne y pescado', total: 6000 },
	{ month: '2026-09', category: 'Supermercado', tag: 'Carne y pescado', total: 6000 },
	{ month: '2026-10', category: 'Supermercado', tag: 'Carne y pescado', total: 9500 },
	{ month: '2026-10', category: 'Supermercado', tag: 'Bebidas', total: 2000 }
];

test('the last 12 months, and the average of the full ones since the first', () => {
	const a = analyse(byCategory, byTag, { current: CURRENT, period: 6, first: '2026-07' });
	expect(a.months).toHaveLength(12);
	expect(a.months[0]).toEqual({ month: '2025-11', total: 0 });
	expect(a.months.at(-1)).toEqual({ month: '2026-10', total: 44500 });
	expect(a.average).toBe(39000);
});

test('above its usual: much more and by at least 10 €, a new category too; not a new tag, nor slightly up', () => {
	const a = analyse(byCategory, byTag, { current: CURRENT, period: 6, first: '2026-07' });
	expect(a.above).toEqual([
		{ category: 'Viajes', tag: null, now: 15000, usual: 0 },
		{ category: 'Supermercado', tag: 'Carne y pescado', now: 9500, usual: 6000 }
	]);
});

test('nothing to compare in the first month', () => {
	const a = analyse(byCategory, byTag, { current: CURRENT, period: 6, first: CURRENT });
	expect(a.above).toBeNull();
	expect(a.average).toBeNull();
	expect(a.periodMonths).toBe(1);
});

test("the period's categories, per month since the first, with their tags and what they miss", () => {
	const a = analyse(byCategory, byTag, { current: CURRENT, period: 3, first: '2026-07' });
	expect(a.periodMonths).toBe(3);
	expect(a.categories[0]).toEqual({
		category: 'Supermercado',
		total: 80000,
		perMonth: 26667,
		tags: [
			{ tag: 'Carne y pescado', total: 21500 },
			{ tag: 'Bebidas', total: 2000 },
			{ tag: UNTAGGED, total: 56500 }
		]
	});
	expect(a.categories.find((c) => c.category === 'Gasolina')?.tags).toEqual([]);
});
