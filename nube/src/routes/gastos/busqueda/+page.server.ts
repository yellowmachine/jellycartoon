import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { searchFromUrl } from '#lib/server/expenses/search-filters.ts';

/** Gastos → Búsqueda: by words, days and an own tag (search-filters.ts). No pages. */
export const load: PageServerLoad = async ({ locals, url }) =>
	searchFromUrl(await kitchenOf(locals.user!.id), url);
