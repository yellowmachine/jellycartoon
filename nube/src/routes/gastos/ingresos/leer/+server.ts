import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { kindOf, MAX_DOCUMENT_BYTES } from '#lib/server/expenses/income.ts';
import { readIncomeInvoice } from '#lib/server/expenses/receipt.ts';

/**
 * An income's invoice (#384), read by the AI: what it says, to check in the form. Nothing is
 * kept: the form sends the file again with the income.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = (await request.formData()).get('factura');
	if (!(file instanceof File) || !file.size) error(400, 'Falta la factura');
	if (file.size > MAX_DOCUMENT_BYTES) error(413, 'La factura pasa de 10 MB');
	const bytes = Buffer.from(await file.arrayBuffer());
	const mime = kindOf(bytes);
	if (!mime) error(400, 'La factura tiene que ser un PDF o una foto (JPG, PNG o WebP)');
	try {
		return json(await readIncomeInvoice(k, bytes, mime));
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer la factura');
	}
};
