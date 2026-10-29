import type { PageServerLoad } from './$types';
import { isDay } from 'comun/expenses.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { SEARCH_LIMIT, searchExpenses } from '#lib/server/expenses/expenses.ts';

/**
 * Gastos → Búsqueda: by words (`?q=`, in the shop or a line) and between two days (`?desde=`,
 * `?hasta=`). Without any, nothing yet. No pages: the newest SEARCH_LIMIT.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const day = (name: string) => {
		const value = url.searchParams.get(name);
		return isDay(value) ? value : null;
	};
	const from = day('desde');
	const to = day('hasta');
	const asked = Boolean(text || from || to);
	const expenses = asked
		? await searchExpenses(await kitchenOf(locals.user!.id), { text, from, to })
		: [];
	return { text, from, to, asked, expenses, limit: SEARCH_LIMIT };
};
