import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { typeOf } from '#lib/server/expenses/income.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { fileResponse } from '#lib/server/storage.ts';
import { PHOTOS_AREA, walkPhotoFile } from '#lib/server/walks/walks.ts';

/** A walk's photo (#416): only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await walkPhotoFile(k, Number(params.id));
	if (!file) error(404, 'Foto no encontrada');
	return fileResponse(k.familyId, PHOTOS_AREA, file, typeOf(file) ?? 'image/jpeg');
};
