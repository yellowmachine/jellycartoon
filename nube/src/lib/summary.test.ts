import { expect, test } from 'bun:test';
import type { Expense, ExpenseCategory } from 'comun/expenses.ts';
import { cardLines, changeText, moneyOf, summaryPeriod } from './summary.ts';

// A Wednesday.
const TODAY = '2026-11-25';

test('the last 7 days, today included, beside the 7 before', () => {
	expect(summaryPeriod('dias', null, TODAY)).toMatchObject({
		from: '2026-11-19',
		to: '2026-11-25',
		prevFrom: '2026-11-12',
		prevTo: '2026-11-18',
		before: null,
		after: null,
		until: '2026-12-02'
	});
});

test('weeks and months, only those over', () => {
	const week = summaryPeriod('semana', null, TODAY);
	expect(week).toMatchObject({
		from: '2026-11-16',
		to: '2026-11-22',
		prevFrom: '2026-11-09',
		before: '2026-11-09',
		after: null,
		until: '2026-11-29'
	});
	// This week, not over: the last.
	expect(summaryPeriod('semana', TODAY, TODAY)).toEqual(week);
	expect(summaryPeriod('semana', '2026-11-11', TODAY)).toMatchObject({
		from: '2026-11-09',
		after: '2026-11-16',
		until: null
	});
	expect(summaryPeriod('mes', null, TODAY)).toMatchObject({
		from: '2026-10-01',
		to: '2026-10-31',
		prevFrom: '2026-09-01',
		prevTo: '2026-09-30',
		after: null,
		until: '2026-11-30'
	});
	expect(summaryPeriod('mes', '2026-01-15', TODAY)).toMatchObject({
		from: '2026-01-01',
		prevFrom: '2025-12-01',
		prevTo: '2025-12-31',
		after: '2026-02-01'
	});
	expect(summaryPeriod('mes', '2027-05-01', TODAY).from).toBe('2026-10-01');
});

const e = (id: number, category: ExpenseCategory, total: number, fixed = false) =>
	({ id, date: TODAY, store: `T${id}`, category, total, fixed }) as Expense;

test('money: the fixed apart, what changed and the largest; nothing, none', () => {
	expect(moneyOf([], [])).toBeNull();
	expect(moneyOf([{ ...e(1, 'Casa', 500), source: 'fijo' }], [])).toMatchObject({
		total: 0,
		fixed: 500
	});
	const m = moneyOf(
		[e(1, 'Supermercado', 9000), e(2, 'Gasolina', 5000), e(3, 'Casa', 60000, true)],
		[e(4, 'Supermercado', 4000), e(5, 'Restaurantes', 3000), e(6, 'Gasolina', 4500)]
	)!;
	expect(m).toMatchObject({ total: 14000, count: 2, before: 11500, fixed: 60000 });
	expect(m.categories.map((c) => c.category)).toEqual(['Supermercado', 'Gasolina']);
	expect(m.up).toEqual([{ category: 'Supermercado', by: 5000 }]);
	expect(m.down).toEqual([{ category: 'Restaurantes', by: -3000 }]);
	expect(m.largest.map((l) => l.id)).toEqual([1, 2]);
	// Nothing before: no changes to tell.
	expect(moneyOf([e(1, 'Supermercado', 9000)], [])).toMatchObject({ before: null, up: [] });
});

test('a percentage only when it says something', () => {
	expect(changeText(14000, 11500, 2000)).toBe('+22 %');
	expect(changeText(8200, 10000, 2000)).toBe('−18 %');
	expect(changeText(10000, 10001, 2000)).toBe('igual');
	expect(changeText(1000, 200, 2000)).toBeNull();
	expect(changeText(1000, null, 2000)).toBeNull();
});

test('the card: only what there is', () => {
	const as = { euros: (c: number) => `${c / 100} €`, distance: (m: number) => `${m / 1000} km` };
	expect(
		cardLines({
			money: { total: 14200, before: 17300 },
			walks: { metres: 12400, before: { metres: 1000 } },
			next: { count: 4 },
			...as
		}).map((l) => l.text)
	).toEqual(['142 € (−18 %)', '12.4 km', '4 citas por venir']);
	expect(cardLines({ money: null, walks: null, next: { count: 0 }, ...as })).toEqual([]);
});
