import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { ownSave, saveStateFile } from '#lib/server/game-saves.ts';

/** A saved game's emulator state, to load it: only the person's own. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const save = await ownSave(locals.user!.id, Number(params.id));
	if (!save) error(404, 'Partida no encontrada');
	return fileResponse(
		request,
		saveStateFile(save.id),
		'application/octet-stream',
		'private, no-cache'
	);
};
