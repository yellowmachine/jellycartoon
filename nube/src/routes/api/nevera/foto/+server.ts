import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { NotAPhoto, setShoppingPhoto } from '#lib/server/shopping-photos.ts';

/** It comes already small (shrinkPhoto). */
const MAX_BYTES = 5 * 1024 * 1024;

/** The photo of an item of the shopping list (`?id=`), as it is in the body. */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const id = Number(url.searchParams.get('id') || NaN);
	if (!Number.isInteger(id)) error(400, 'Petición no válida');
	if (Number(request.headers.get('content-length')) > MAX_BYTES)
		error(413, 'La foto es demasiado grande');
	const file = new Uint8Array(await request.arrayBuffer());
	if (file.length > MAX_BYTES) error(413, 'La foto es demasiado grande');
	try {
		if (!(await setShoppingPhoto(await kitchenOf(locals.user!.id), id, file)))
			error(404, 'Eso ya no está en la lista');
	} catch (err) {
		if (err instanceof NotAPhoto) error(415, err.message);
		throw err;
	}
	return json({ ok: true });
};
