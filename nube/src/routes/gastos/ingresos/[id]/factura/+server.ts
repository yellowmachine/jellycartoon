import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { INCOME_AREA, incomeDocument, typeOf } from '#lib/server/expenses/income.ts';
import { fileResponse } from '#lib/server/storage.ts';

/** An income's invoice (#384): only the family's own, as it is found through its family. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const name = await incomeDocument(k, Number(params.id));
	const type = name && typeOf(name);
	if (!name || !type) error(404, 'Sin factura');
	return fileResponse(k.familyId, INCOME_AREA, name, type);
};
