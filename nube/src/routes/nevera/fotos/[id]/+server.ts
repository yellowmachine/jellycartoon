import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { typeOf } from '#lib/server/expenses/income.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { SHOPPING_PHOTOS, shoppingPhotoFile } from '#lib/server/shopping-photos.ts';
import { fileResponse } from '#lib/server/storage.ts';

/** The photo of a thing to buy, the family's. Its name changes with each new one (`?v=`), so it is cached. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await shoppingPhotoFile(k, Number(params.id));
	if (!file) error(404, 'Foto no encontrada');
	return fileResponse(k.familyId, SHOPPING_PHOTOS, file, typeOf(file) ?? 'image/jpeg');
};
