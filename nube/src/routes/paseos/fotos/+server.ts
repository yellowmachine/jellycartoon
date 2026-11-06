import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_DOCUMENT_BYTES, NotADocument } from '#lib/server/expenses/income.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sentAttachment } from '#lib/server/walks/attachment.ts';
import { addWalkPhoto } from '#lib/server/walks/walks.ts';

/** A photo taken on a walk (#416), from the device that kept it; 404, that walk is gone. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const sent = await sentAttachment(request, MAX_DOCUMENT_BYTES);
	if ('problem' in sent) {
		console.warn('[paseos] Foto rechazada', sent.status);
		error(sent.status, sent.problem);
	}
	if (!sent.startedAt) error(400, 'Falta de qué paseo es');
	try {
		const kept = await addWalkPhoto(await kitchenOf(locals.user!.id), {
			...sent,
			startedAt: sent.startedAt
		});
		if (!kept) {
			console.warn('[paseos] Foto rechazada', 404);
			error(404, 'Ese paseo ya no está');
		}
	} catch (err) {
		if (err instanceof NotADocument) {
			console.warn('[paseos] Foto rechazada', 415);
			error(415, err.message);
		}
		throw err;
	}
	return json({ kept: true });
};
