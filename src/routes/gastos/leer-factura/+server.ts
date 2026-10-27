import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { readBill } from '#lib/server/expenses/receipt.ts';

/** A bill's PDF, as downloaded from the company, or a photo made smaller in the browser. */
const MAX_BYTES = 8 * 1024 * 1024;

/** A bill (#232), read: what it says, to check and save. Nothing is saved yet. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const file = (await request.formData()).get('factura');
	if (!(file instanceof File) || !file.size) error(400, 'Falta la factura');
	if (file.size > MAX_BYTES) error(413, 'La factura es demasiado grande');
	const bytes = Buffer.from(await file.arrayBuffer());
	// By what it is, not by what the phone calls it: a PDF starts with «%PDF».
	const isPdf = bytes.subarray(0, 4).toString('latin1') === '%PDF';
	if (!isPdf && !file.type.startsWith('image/')) error(415, 'Tiene que ser un PDF o una foto');
	try {
		return json(await readBill(bytes, isPdf, locals.user!.id));
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer la factura');
	}
};
