import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { receiptOf } from '#lib/server/expenses/expenses.ts';
import { AREA } from '#lib/server/expenses/receipt.ts';
import { fileResponse } from '#lib/server/storage.ts';

/**
 * An expense's receipt as photographed (#194), or its bill's PDF (#232): only the family's own, as
 * the expense is found through its family (row-level security).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await receiptOf(k, Number(params.id));
	if (!file) error(404, 'Sin ticket');
	return fileResponse(
		k.familyId,
		AREA,
		file,
		file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
	);
};
