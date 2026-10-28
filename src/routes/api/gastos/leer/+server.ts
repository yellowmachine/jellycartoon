import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { CloudProblem, readReceipt } from '#lib/server/kitchen.ts';

/** Already made smaller in the browser (to 2000 px); a phone's photo as is, still under this. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A receipt's photo from the road mode's fuel (#194), read by the family's AI in the cloud (#253):
 * what it says, to check and save. Nothing is saved yet.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const photo = (await request.formData()).get('foto');
	if (!(photo instanceof File) || !photo.size) error(400, 'Falta la foto del ticket');
	if (photo.size > MAX_BYTES) error(413, 'La foto es demasiado grande');
	try {
		return json(await readReceipt(photo, locals.user!.id));
	} catch (err) {
		error(502, err instanceof CloudProblem ? err.message : 'No se pudo leer el ticket');
	}
};
