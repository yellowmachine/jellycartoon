import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { ownSave, savePicture } from '#lib/server/own-games.ts';

/** A saved game's picture (#564), for the list: only the person's own. It never changes. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const save = await ownSave(familyId, locals.user!.id, Number(params.id));
	const bytes = await savePicture(familyId, save.id);
	if (!bytes) error(404, 'Sin imagen');
	return new Response(bytes, {
		headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000' }
	});
};
