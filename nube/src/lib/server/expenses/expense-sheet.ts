import { utils, write } from 'xlsx';
import { ownTagOf, type Expense, type OwnTags } from 'comun/expenses.ts';

/**
 * Gastos → Búsqueda → «Descargar hoja»: what was searched as an OpenDocument spreadsheet (.ods),
 * which LibreOffice, Excel, Google Sheets and Numbers open, with the amounts as numbers. Two
 * sheets: «Gastos», one row each and the total last; «Líneas», each receipt's or bill's line, to
 * sum by tag. Made with SheetJS (https://docs.sheetjs.com/docs/api/write-options).
 */

const SOURCES: Record<Expense['source'], string> = {
	ticket: 'Ticket',
	factura: 'Factura',
	voz: 'Voz',
	mano: 'A mano',
	fijo: 'Fijo'
};

/** Two decimals and thousands; the euro, in the header: SheetJS leaves a format's text out of an .ods. */
const MONEY = '#,##0.00';
const DAY = 'dd/mm/yyyy';

/** A day as a date of the sheet, not as text: at noon UTC, so no time zone moves it. */
const dayCell = (day: string) => ({ t: 'd', v: new Date(`${day}T12:00:00Z`), z: DAY });
const moneyCell = (cents: number) => ({ t: 'n', v: cents / 100, z: MONEY });

export function expenseSheet(expenses: Expense[], own: OwnTags): ArrayBuffer {
	const book = utils.book_new();

	const rows = expenses.map((e) => [
		dayCell(e.date),
		e.store || null,
		e.category,
		SOURCES[e.source],
		e.by,
		moneyCell(e.total)
	]);
	const total = expenses.reduce((sum, e) => sum + e.total, 0);
	const main = utils.aoa_to_sheet([
		['Fecha', 'Tienda', 'Categoría', 'Origen', 'Quién', 'Importe (€)'],
		...rows,
		[],
		['Total', null, null, null, null, moneyCell(total)]
	]);
	main['!cols'] = [{ wch: 11 }, { wch: 28 }, { wch: 16 }, { wch: 9 }, { wch: 14 }, { wch: 12 }];
	utils.book_append_sheet(book, main, 'Gastos');

	const lines = utils.aoa_to_sheet([
		[
			'Fecha',
			'Tienda',
			'Categoría',
			'Línea',
			'Cantidad',
			'Importe (€)',
			'Etiqueta',
			'Etiqueta propia'
		],
		...expenses.flatMap((e) =>
			e.lines.map((l) => [
				dayCell(e.date),
				e.store || null,
				e.category,
				l.text,
				l.quantity,
				moneyCell(l.amount),
				l.tag,
				ownTagOf(own, l.text)?.name ?? null
			])
		)
	]);
	lines['!cols'] = [
		{ wch: 11 },
		{ wch: 24 },
		{ wch: 16 },
		{ wch: 36 },
		{ wch: 9 },
		{ wch: 12 },
		{ wch: 18 },
		{ wch: 16 }
	];
	utils.book_append_sheet(book, lines, 'Líneas');

	return write(book, { bookType: 'ods', type: 'array', cellDates: true }) as ArrayBuffer;
}
