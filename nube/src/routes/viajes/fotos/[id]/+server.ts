import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { fileResponse } from '#lib/server/storage.ts';
import { ownsPhoto, photoName, PHOTOS } from '#lib/server/trips/photos.ts';

/** A road mode's photo (#81): only for whoever took it. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const k = await kitchenOf(locals.user!.id);
	if (!Number.isInteger(id) || !(await ownsPhoto(k, id))) error(404, 'No encontrada');
	return fileResponse(k.familyId, PHOTOS, photoName(id), 'image/jpeg');
};
