import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { readBill } from '#lib/server/expenses/receipt.ts';
import { isFileHash, lookingSame } from '#lib/server/expenses/duplicates.ts';
import { mergeOfDraft } from '#lib/server/expenses/merge.ts';
import { fixedMatchOf } from '#lib/server/expenses/fixed-receipt.ts';

/** A bill's PDF, as downloaded from the company, or a photo made smaller in the browser. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A bill (#232), read: what it says, to check and save, and the one it looks the same as (#440), if
 * any, and the fixed one it may be the month's of (#501). Nothing is saved yet.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const form = await request.formData();
	const file = form.get('factura');
	if (!(file instanceof File) || !file.size) error(400, 'Falta la factura');
	if (file.size > MAX_BYTES) error(413, 'La factura es demasiado grande');
	const bytes = Buffer.from(await file.arrayBuffer());
	// By what it is, not by what the phone calls it: a PDF starts with «%PDF».
	const isPdf = bytes.subarray(0, 4).toString('latin1') === '%PDF';
	if (!isPdf && !file.type.startsWith('image/')) error(415, 'Tiene que ser un PDF o una foto');
	const hash = form.get('huella');
	try {
		const draft = await readBill(k, bytes, isPdf);
		// Money that came in: Gastos offers to take it to Ingresos; nothing to compare with expenses.
		if (draft.income) return json({ ...draft, repeated: null, fixed: null, merge: null });
		// Put in before (#440): said already while checking what was read.
		const repeated = await lookingSame(k, {
			id: null,
			...draft,
			source: 'factura',
			fileHash: isFileHash(hash) ? hash : null
		}).catch(() => null);
		// A fixed one's of that month or the one before, without its receipt yet (#501)?
		const fixed = await fixedMatchOf(k, draft).catch(() => null);
		// Expenses put in one by one that this gathers?
		const merge = await mergeOfDraft(k, draft).catch(() => null);
		return json({ ...draft, repeated, fixed, merge });
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer la factura');
	}
};
