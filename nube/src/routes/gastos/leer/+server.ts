import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { readReceipt } from '#lib/server/expenses/receipt.ts';

/** Already made smaller in the browser (to 2000 px); a phone's photo as is, still under this. */
const MAX_BYTES = 8 * 1024 * 1024;

/** A receipt's photo (#194), read: what it says, to check and save. Nothing is saved yet. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const photo = (await request.formData()).get('foto');
	if (!(photo instanceof File) || !photo.size) error(400, 'Falta la foto del ticket');
	if (photo.size > MAX_BYTES) error(413, 'La foto es demasiado grande');
	try {
		return json(await readReceipt(k, Buffer.from(await photo.arrayBuffer())));
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer el ticket');
	}
};
