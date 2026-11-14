import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { typeOf } from '#lib/server/expenses/income.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { RECIPE_PHOTOS, recipePhotoFile } from '#lib/server/recipes/photos.ts';
import { fileResponse } from '#lib/server/storage.ts';

/** A recipe's own photo, the family's. Its name changes with each new one (`?v=`), so it is cached. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await recipePhotoFile(k, Number(params.id));
	if (!file) error(404, 'Foto no encontrada');
	return fileResponse(k.familyId, RECIPE_PHOTOS, file, typeOf(file) ?? 'image/jpeg');
};
