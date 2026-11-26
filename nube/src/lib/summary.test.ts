import { expect, test } from 'bun:test';
import type { Expense, ExpenseCategory } from 'comun/expenses.ts';
import type { Medication } from 'comun/medication.ts';
import type { KwhPrice } from '#lib/kwh-price.ts';
import {
	cardLines,
	changeText,
	energyOf,
	medicationOf,
	moneyOf,
	per100Km,
	shoppingOf,
	summaryPeriod,
	wishesOf,
	type BoughtWish,
	type EnergyHour
} from './summary.ts';

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

const ticket = (
	id: number,
	date: string,
	store: string,
	lines: [string, number, (number | null)?][],
	more: Partial<Expense> = {}
) =>
	({
		id,
		date,
		store,
		category: 'Supermercado',
		source: 'ticket',
		fixed: false,
		foreign: null,
		total: lines.reduce((s, l) => s + l[1], 0),
		lines: lines.map(([text, amount, quantity = null]) => ({
			text,
			amount,
			quantity,
			tag: 'Otros'
		})),
		...more
	}) as Expense;

test('compras: what repeats, and what is dearer than the last time in the same shop', () => {
	expect(shoppingOf([], [])).toBeNull();
	const now = [
		ticket(10, '2026-11-20', 'Mercadona', [
			['Barra picos', 125],
			['LECHE  entera', 540, 6],
			['Descuento', -100]
		]),
		ticket(11, '2026-11-22', 'mercadona ', [
			['barra picos', 130],
			['Plátanos', 220, 1.1]
		]),
		ticket(12, '2026-11-23', 'Lidl', [['Barra Picos', 99]]),
		// Not purchases: a bill and a fixed one.
		ticket(13, '2026-11-23', 'Iberdrola', [['Energía', 5000]], { source: 'factura' }),
		ticket(14, '2026-11-23', 'Gym', [['Cuota', 3000]], { fixed: true })
	];
	const earlier = [
		ticket(1, '2026-08-01', 'Mercadona', [['Barra picos', 100]]),
		ticket(2, '2026-10-01', 'Mercadona', [
			['barra picos', 115],
			['Leche entera', 510, 6],
			['Plátanos', 216, 1.1]
		]),
		// Dearer in another shop says nothing of Mercadona's.
		ticket(3, '2026-10-05', 'Lidl', [['Barra picos', 140]]),
		ticket(4, '2026-10-06', 'Iberdrola', [['Energía', 1000]], { source: 'factura' })
	];
	const s = shoppingOf(now, earlier)!;
	expect(s.repeated).toEqual([{ text: 'Barra picos', times: 3, total: 354 }]);
	// The newest beside the newest before: 1,15 → 1,30. Leche by unit: 0,85 → 0,90 (+6 %).
	// Plátanos 1,96 → 2,00 a kg: too little. Lidl, cheaper. Bills and fixed, never.
	expect(s.dearer.map((d) => [d.text, d.was, d.now, d.percent, d.id])).toEqual([
		['barra picos', 115, 130, 13, 11],
		['LECHE entera', 85, 90, 6, 10]
	]);
	// Bought once, and no price before: nothing to say.
	expect(shoppingOf([ticket(1, '2026-11-20', 'Mercadona', [['Pan', 100]])], [])).toBeNull();
});

test('energía: each hour at its price, the one before as far in, the hours without data', () => {
	const at = (iso: string) => new Date(iso);
	const range = {
		prevStart: at('2026-11-12T00:00:00Z'),
		prevEnd: at('2026-11-14T00:00:00Z'),
		start: at('2026-11-19T00:00:00Z'),
		end: at('2026-11-26T00:00:00Z')
	};
	const plugs = [
		{ id: 'a', name: 'Lavadora' },
		{ id: 'b', name: 'Tele' },
		{ id: 'c', name: 'Nevera' }
	];
	const h = (plugId: string, iso: string, wh: number, mark: string | null = null): EnergyHour => ({
		plugId,
		hour: at(iso),
		wh,
		mark
	});
	const price = {
		source: 'mano',
		pricing: 'fijo',
		flat: 0.2,
		periods: null,
		from: null
	} as KwhPrice;
	expect(energyOf([], plugs, price, range)).toBeNull();
	const rows = [
		h('a', '2026-11-20T10:00:00Z', 2000),
		h('b', '2026-11-20T21:00:00Z', 500),
		h('c', '2026-11-21T03:00:00Z', 0, 'sin_dato'),
		h('a', '2026-11-12T10:00:00Z', 1000),
		// After the same point of the one before: not compared.
		h('a', '2026-11-15T10:00:00Z', 9000),
		// Not the family's any more.
		h('z', '2026-11-20T10:00:00Z', 9000)
	];
	expect(energyOf(rows, plugs, price, range)).toEqual({
		wh: 2500,
		cents: 50,
		before: { wh: 1000, cents: 20 },
		plugs: [
			{ id: 'a', name: 'Lavadora', wh: 2000, cents: 40 },
			{ id: 'b', name: 'Tele', wh: 500, cents: 10 }
		],
		noData: 1
	});
	// Without a price, only the kWh.
	expect(energyOf(rows, plugs, null, range)).toMatchObject({
		cents: null,
		before: { cents: null }
	});
});

test('coche: cost per 100 km only with enough km and fuel', () => {
	expect(per100Km({ metres: 400_000, fuel: 4000 })).toBe(1000);
	expect(per100Km({ metres: 40_000, fuel: 4000 })).toBeNull();
	expect(per100Km({ metres: 400_000, fuel: 0 })).toBeNull();
});

test('medicación: doses due up to now, the marked ones, the missed latest first', () => {
	const med = (id: number, personId: string, times: string[], more: Partial<Medication> = {}) =>
		({
			id,
			personId,
			name: `M${id}`,
			dose: null,
			times,
			doses: [],
			days: [],
			startDay: '2026-11-01',
			endDay: null,
			...more
		}) as Medication;
	const meds = [
		med(1, '1', ['08:00', '21:00']),
		// Started on the 24th.
		med(2, '2', ['09:00'], { startDay: '2026-11-24' }),
		// Not theirs.
		med(3, '9', ['09:00'])
	];
	const people = [
		{ id: '1', name: 'Ana' },
		{ id: '2', name: 'Leo' },
		{ id: '3', name: 'Sin nada' }
	];
	const taken = new Set(['1 2026-11-24 08:00', '1 2026-11-24 21:00', '1 2026-11-25 08:00']);
	const out = medicationOf(meds, taken, people, '2026-11-24', '2026-11-30', {
		day: '2026-11-25',
		time: '12:00'
	});
	expect(out).toEqual([
		{ personId: '1', name: 'Ana', taken: 3, due: 3, missed: [], more: 0 },
		{
			personId: '2',
			name: 'Leo',
			taken: 0,
			due: 2,
			missed: [
				{ day: '2026-11-25', time: '09:00', name: 'M2' },
				{ day: '2026-11-24', time: '09:00', name: 'M2' }
			],
			more: 0
		}
	]);
});

test('deseos: each expense once, its price without one, the ones in another currency apart', () => {
	expect(wishesOf([], new Map())).toBeNull();
	const w = (id: number, more: Partial<BoughtWish>): BoughtWish => ({
		id,
		title: `D${id}`,
		person: 'Ana',
		shop: 'Amazon',
		on: '2026-11-20',
		priceCents: null,
		shippingCents: null,
		extraCents: null,
		currency: 'EUR',
		expenseId: null,
		...more
	});
	const out = wishesOf(
		[
			// Two bought together: one expense.
			w(1, { expenseId: 7, priceCents: 1000 }),
			w(2, { expenseId: 7, priceCents: 2000, on: '2026-11-21' }),
			w(3, { priceCents: 1500, shippingCents: 300, extraCents: 200 }),
			w(4, { priceCents: 999, currency: 'USD' }),
			w(5, {})
		],
		new Map([[7, 3299]])
	)!;
	expect(out).toMatchObject({ count: 5, total: 3299 + 2000, unknown: 2 });
	expect(out.items[0]).toMatchObject({ id: 2, cents: 2000 });
	expect(out.items.find((i) => i.id === 3)!.cents).toBe(2000);
});
