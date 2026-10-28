import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readReceipt } from '#lib/server/expenses/receipt.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/** Already made smaller in the browser (to 2000 px); a phone's photo as is, still under this. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A receipt's photo from the house (the road mode's fuel, #194), read with the family's AI: what
 * it says, and the photo waiting in the family's storage until the expense is saved. The photo is
 * the request's body itself (`image/jpeg`): a form from a server, with no Origin, is refused by
 * SvelteKit's CSRF check.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	if (!request.headers.get('content-type')?.startsWith('image/'))
		error(415, 'Tiene que ser una foto');
	const photo = Buffer.from(await request.arrayBuffer());
	if (!photo.length) error(400, 'Falta la foto del ticket');
	if (photo.length > MAX_BYTES) error(413, 'La foto es demasiado grande');
	try {
		return json(await readReceipt(k, photo));
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'No se pudo leer el ticket');
	}
};
