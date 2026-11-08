import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { readBill } from '#lib/server/expenses/receipt.ts';
import { isFileHash, lookingSame } from '#lib/server/expenses/duplicates.ts';

/** A bill's PDF, as downloaded from the company, or a photo made smaller in the browser. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A bill (#232), read: what it says, to check and save, and the one it looks the same as (#440), if
 * any. Nothing is saved yet.
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
		// Put in before (#440): said already while checking what was read.
		const repeated = await lookingSame(k, {
			id: null,
			...draft,
			source: 'factura',
			fileHash: isFileHash(hash) ? hash : null
		}).catch(() => null);
		return json({ ...draft, repeated });
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer la factura');
	}
};
