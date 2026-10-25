import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { ownSave, savePictureFile } from '#lib/server/game-saves.ts';

/** A saved game's picture, for the list: only the person's own. It never changes. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const save = await ownSave(locals.user!.id, Number(params.id));
	if (!save) error(404, 'Partida no encontrada');
	return fileResponse(request, savePictureFile(save.id), 'image/png', 'private, max-age=31536000');
};
