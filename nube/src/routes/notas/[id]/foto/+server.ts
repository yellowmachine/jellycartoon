import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { typeOf } from '#lib/server/expenses/income.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { notePhoto, NOTES_AREA } from '#lib/server/notes.ts';
import { fileResponse } from '#lib/server/storage.ts';

/** A note's photo: one's own, or shared with the house. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await notePhoto(k, locals.user!.id, Number(params.id));
	if (!file) error(404, 'Sin foto');
	return fileResponse(k.familyId, NOTES_AREA, file, typeOf(file) ?? 'image/jpeg');
};
