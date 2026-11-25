import { expect, test } from 'bun:test';
import { nextDue } from 'comun/expenses.ts';
import { chargesSummary, chargeText, type Charge } from './charges.ts';

const charge = (name: string, amount: number, left: number, account: string | null): Charge => ({
	id: 1,
	name,
	amount,
	day: '2026-11-28',
	left,
	account
});
const plain = (t: string) => t.replace(/\s/g, ' ');

test('the next day of a fixed one, its day included and not one already added', () => {
	expect(nextDue({ day: 28, month: null }, '2026-10', '2026-11-25')).toBe('2026-11-28');
	expect(nextDue({ day: 25, month: null }, '2026-10', '2026-11-25')).toBe('2026-11-25');
	expect(nextDue({ day: 25, month: null }, '2026-11', '2026-11-25')).toBe('2026-12-25');
	expect(nextDue({ day: 1, month: null }, '2026-11', '2026-11-25')).toBe('2026-12-01');
	expect(nextDue({ day: 2, month: 1 }, '2026-01', '2026-12-30')).toBe('2027-01-02');
	expect(nextDue({ day: 2, month: 11 }, '2026-11', '2026-11-25')).toBe('2027-11-02');
	expect(nextDue({ day: 5, month: null }, null, '2026-11-25')).toBe('2026-12-05');
});

test('in words: one, and several by account', () => {
	expect(plain(chargeText(charge('Amazon Prime', 499, 3, 'Santander')))).toBe(
		'En 3 días, Amazon Prime: 4,99 €. Que haya saldo en Santander.'
	);
	expect(plain(chargeText(charge('Gas', 3000, 1, null)))).toBe(
		'Mañana, Gas: 30,00 €. Asegúrate de que haya saldo.'
	);
	expect(
		plain(
			chargesSummary([
				charge('Prime', 499, 3, 'Santander'),
				charge('Seguro', 4999, 5, 'santander'),
				charge('Gas', 999, 0, null)
			])
		)
	).toBe('En los próximos 5 días, 3 cargos: 54,98 € en Santander y 9,99 € sin cuenta apuntada.');
	expect(plain(chargesSummary([charge('A', 100, 0, null), charge('B', 200, 0, null)]))).toBe(
		'Hoy, 2 cargos: 3,00 €.'
	);
});
