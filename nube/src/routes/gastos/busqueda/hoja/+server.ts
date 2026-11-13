import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { expenseSheet } from '#lib/server/expenses/expense-sheet.ts';
import { searchFromUrl } from '#lib/server/expenses/search-filters.ts';

/**
 * Gastos → Búsqueda → «Descargar hoja»: the same filters as the page, every expense they find
 * (none, the whole history), as a .ods to download, without drawing them in the page first.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { expenses, own, from, to } = await searchFromUrl(await kitchenOf(locals.user!.id), url, {
		all: true
	});
	const name = ['gastos', from ?? (to ? 'inicio' : null), to ?? (from ? 'hoy' : null)]
		.filter(Boolean)
		.join('_');
	return new Response(expenseSheet(expenses, own), {
		headers: {
			'content-type': 'application/vnd.oasis.opendocument.spreadsheet',
			'content-disposition': `attachment; filename="${name}.ods"`,
			'cache-control': 'private, no-store'
		}
	});
};
