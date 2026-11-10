import type { PageServerLoad } from './$types';
import { isDay } from 'comun/expenses.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { SEARCH_LIMIT, searchExpenses } from '#lib/server/expenses/expenses.ts';
import { ownTags, taggedExpenseIds } from '#lib/server/expenses/own-tags.ts';

/**
 * Gastos → Búsqueda: by words (`?q=`, in the shop or a line), between two days (`?desde=`,
 * `?hasta=`) and by an own tag (`?etiqueta=`, #459). Without any, nothing yet. No pages: the newest
 * SEARCH_LIMIT; by a tag, all of them, so its sum is whole.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
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
	const expenses = searched
		? await searchExpenses(
				k,
				{ text, from, to },
				tag ? { ids: await taggedExpenseIds(k, tag.id, { from, to }), limit: null } : undefined
			)
		: [];
	return {
		text,
		from,
		to,
		tag,
		own,
		asked: searched,
		expenses,
		limit: tag ? null : SEARCH_LIMIT
	};
};
