import { expect, test } from 'bun:test';
import { read, utils } from 'xlsx';
import type { Expense } from 'comun/expenses.ts';
import { expenseSheet } from './expense-sheet.ts';

const base: Expense = {
	id: 1,
	date: '2026-11-03',
	store: 'Mercadona',
	category: 'Supermercado',
	total: 1250,
	source: 'ticket',
	by: 'Ana',
	hasReceipt: true,
	bill: null,
	fixed: false,
	lines: [
		{ text: 'Barra picos', quantity: 2, amount: 250, tag: 'Panadería' },
		{ text: 'Leche', quantity: null, amount: 1000, tag: 'Lácteos y huevos' }
	]
};

test('the searched expenses, and their lines, as two sheets with numbers and dates', () => {
	const ods = expenseSheet(
		[
			base,
			{
				...base,
				id: 2,
				date: '2026-11-01',
				store: '',
				source: 'voz',
				by: null,
				total: 300,
				lines: []
			}
		],
		{ tags: [{ id: 7, name: 'Pan' }], rules: { 'barra picos': 7 } }
	);
	const book = read(ods, { cellDates: true });
	expect(book.SheetNames).toEqual(['Gastos', 'Líneas']);

	const main = utils.sheet_to_json<unknown[]>(book.Sheets.Gastos!, { header: 1, blankrows: false });
	expect(main[0]).toEqual(['Fecha', 'Tienda', 'Categoría', 'Origen', 'Quién', 'Importe (€)']);
	expect(main[1]!.slice(1)).toEqual(['Mercadona', 'Supermercado', 'Ticket', 'Ana', 12.5]);
	expect((main[1]![0] as Date).toISOString().slice(0, 10)).toBe('2026-11-03');
	expect(main[2]!.slice(1)).toEqual([undefined, 'Supermercado', 'Voz', undefined, 3]);
	expect(main.at(-1)).toEqual(['Total', undefined, undefined, undefined, undefined, 15.5]);

	const lines = utils.sheet_to_json<Record<string, unknown>>(book.Sheets['Líneas']!);
	expect(
		lines.map((l) => [l['Línea'], l.Cantidad, l['Importe (€)'], l['Etiqueta propia']])
	).toEqual([
		['Barra picos', 2, 2.5, 'Pan'],
		['Leche', undefined, 10, undefined]
	]);
});
