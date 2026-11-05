import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { noteAudio, NOTES_AREA } from '#lib/server/notes.ts';
import { fileResponse } from '#lib/server/storage.ts';
import { audioTypeOf } from '#lib/notes.ts';

/** A note's recording (#416): only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await noteAudio(k, locals.user!.id, Number(params.id));
	const type = file && audioTypeOf(file);
	if (!file || !type) error(404, 'Sin audio');
	return fileResponse(k.familyId, NOTES_AREA, file, type);
};
