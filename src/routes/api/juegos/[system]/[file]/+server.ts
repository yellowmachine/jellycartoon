import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { romFile } from '#lib/server/games.ts';
import { fileResponse } from 'comun/server/file-response.ts';

/**
 * A game's file as is (a ROM, or a .zip or .7z with it), or the BIOS it needs: EmulatorJS opens it
 * in the browser.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const file = await romFile(params.system, params.file);
	if (!file) error(404, 'Juego no encontrado');
	return fileResponse(request, file, 'application/octet-stream', 'private, max-age=86400');
};
