import { error, json } from '@sveltejs/kit';
import { isDay } from 'comun/expenses.ts';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { mergeable } from '#lib/server/expenses/merge.ts';

/** The expenses one of `?dia=` may gather, to choose by hand. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const day = url.searchParams.get('dia');
	if (!isDay(day)) error(400, 'Fecha no válida');
	return json(await mergeable(await kitchenOf(locals.user!.id), day));
};
