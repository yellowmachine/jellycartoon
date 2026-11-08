import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { readReceipt } from '#lib/server/expenses/receipt.ts';
import { isFileHash, lookingSame } from '#lib/server/expenses/duplicates.ts';

/** Already made smaller in the browser (to 2000 px); a phone's photo as is, still under this. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A receipt's photo (#194), read: what it says, to check and save, and the one it looks the same as
 * (#440), if any. Nothing is saved yet.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const form = await request.formData();
	const photo = form.get('foto');
	if (!(photo instanceof File) || !photo.size) error(400, 'Falta la foto del ticket');
	if (photo.size > MAX_BYTES) error(413, 'La foto es demasiado grande');
	const hash = form.get('huella');
	try {
		const draft = await readReceipt(k, Buffer.from(await photo.arrayBuffer()));
		// Put in before (#440): said already while checking what was read.
		const repeated = await lookingSame(k, {
			id: null,
			...draft,
			source: 'ticket',
			fileHash: isFileHash(hash) ? hash : null
		}).catch(() => null);
		return json({ ...draft, repeated });
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer el ticket');
	}
};
