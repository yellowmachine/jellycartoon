import { isDay } from 'comun/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { SEARCH_LIMIT, searchExpenses } from '#lib/server/expenses/expenses.ts';
import { ownTags, taggedExpenseIds } from '#lib/server/expenses/own-tags.ts';

/**
 * Gastos → Búsqueda's filters, the same for the page and its spreadsheet: by words (`?q=`, in the
 * shop or a line), between two days (`?desde=`, `?hasta=`) and by an own tag (`?etiqueta=`, #459).
 * The page: without any, nothing yet; the newest SEARCH_LIMIT, or all of a tag so its sum is whole.
 * The sheet (`all`): every one, and without any filter, the whole history.
 */
export async function searchFromUrl(k: Kitchen, url: URL, { all = false } = {}) {
	const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const day = (name: string) => {
		const value = url.searchParams.get(name);
		return isDay(value) ? value : null;
	};
	const from = day('desde');
	const to = day('hasta');
	const own = await ownTags(k);
	const asked = Number(url.searchParams.get('etiqueta'));
	const tag = own.tags.find((t) => t.id === asked) ?? null;
	const searched = Boolean(text || from || to || tag);
	const limit = all || tag ? null : SEARCH_LIMIT;
	const expenses =
		searched || all
			? await searchExpenses(
					k,
					{ text, from, to },
					tag ? { ids: await taggedExpenseIds(k, tag.id, { from, to }), limit } : { limit }
				)
			: [];
	return { text, from, to, tag, own, asked: searched, expenses, limit };
}
