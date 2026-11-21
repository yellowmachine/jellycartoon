import { expect, test } from 'bun:test';
import { parseExpenseInput, type ExpenseInput } from 'comun/expenses.ts';
import { eurosPerUnit, inEuros } from './fx.ts';
import { currencyOf } from './receipt-parse.ts';

const READ: ExpenseInput = {
	date: '2026-11-20',
	store: 'Target',
	category: 'Supermercado',
	total: 2500,
	lines: [
		{ text: 'Milk', quantity: 1, amount: 499, tag: 'Lácteos y huevos' },
		{ text: 'Bread', quantity: 1, amount: 2001, tag: 'Panadería' }
	]
};

test('the currency the model says; none or nonsense, euros', () => {
	expect(currencyOf({ currency: 'usd' })).toBe('USD');
	expect(currencyOf({ currency: ' GBP ' })).toBe('GBP');
	expect(currencyOf({ currency: '$' })).toBe('EUR');
	expect(currencyOf({})).toBe('EUR');
	expect(currencyOf(null)).toBe('EUR');
});

test('in dollars: in euros, with the receipt beside', () => {
	const out = inEuros(READ, 'USD', 0.90992);
	expect(out.total).toBe(2275);
	expect(out.lines.map((l) => l.amount)).toEqual([454, 1821]);
	expect(out.foreign).toEqual({ currency: 'USD', total: 2500, rate: 0.90992 });
});

test('without a rate, as read and said so; in euros, as it is', () => {
	const out = inEuros(READ, 'USD', null);
	expect(out.total).toBe(2500);
	expect(out.foreign).toEqual({ currency: 'USD', total: 2500, rate: null });
	expect(inEuros(READ, 'EUR', null)).toEqual({ ...READ, foreign: null });
});

test("Frankfurter's rate of the day; an error or nonsense, none", async () => {
	let asked = '';
	const answer = (body: unknown, status = 200) =>
		(async (url: string) => {
			asked = url;
			return new Response(JSON.stringify(body), { status });
		}) as unknown as typeof fetch;
	expect(await eurosPerUnit('USD', '2026-11-20', answer({ rates: { EUR: 0.91 } }))).toBe(0.91);
	expect(asked).toBe('https://api.frankfurter.dev/v1/2026-11-20?base=USD&symbols=EUR');
	expect(await eurosPerUnit('XYZ', '2026-11-20', answer({ message: 'not found' }, 404))).toBe(null);
	expect(await eurosPerUnit('USD', '2026-11-20', answer({ rates: { EUR: 'x' } }))).toBe(null);
	const down = (async () => {
		throw new Error('offline');
	}) as unknown as typeof fetch;
	expect(await eurosPerUnit('USD', '2026-11-20', down)).toBe(null);
});

test('what a page sends of another currency, only if well formed', () => {
	const body = { ...READ, foreign: { currency: 'USD', total: 2500, rate: 0.91 } };
	expect(parseExpenseInput(body)?.foreign).toEqual({ currency: 'USD', total: 2500, rate: 0.91 });
	expect(
		parseExpenseInput({ ...READ, foreign: { currency: 'USD', total: 2500, rate: null } })?.foreign
	).toEqual({ currency: 'USD', total: 2500, rate: null });
	// Not sent: left as it is; null or bad: in euros.
	expect('foreign' in parseExpenseInput(READ)!).toBe(false);
	expect(parseExpenseInput({ ...READ, foreign: null })?.foreign).toBe(null);
	expect(
		parseExpenseInput({ ...READ, foreign: { currency: 'EUR', total: 1, rate: 1 } })?.foreign
	).toBe(null);
	expect(
		parseExpenseInput({ ...READ, foreign: { currency: 'usd', total: 1, rate: 1 } })?.foreign
	).toBe(null);
	expect(
		parseExpenseInput({ ...READ, foreign: { currency: 'USD', total: 1, rate: -1 } })?.foreign
	).toBe(null);
});
