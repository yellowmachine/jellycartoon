import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { walkNotes } from '#lib/server/notes.ts';
import { walkLine, walkPhotos } from '#lib/server/walks/walks.ts';

/** A walk's positions (#410), photos and notes (#416), when it is opened: only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Paseo no encontrado');
	const k = await kitchenOf(locals.user!.id);
	const line = await walkLine(k, id);
	if (!line) error(404, 'Paseo no encontrado');
	const [photos, notes] = await Promise.all([walkPhotos(k, id), walkNotes(k, id)]);
	return json({ line, photos: photos.map(({ file: _, ...p }) => p), notes });
};
