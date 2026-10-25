import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findGame } from '#lib/server/games.ts';
import { fileResponse } from '#lib/server/file-response.ts';

/** A game's file as is (a ROM, or a .zip or .7z with it): EmulatorJS opens it in the browser. */
export const GET: RequestHandler = async ({ params, request }) => {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	return fileResponse(request, game.path, 'application/octet-stream', 'private, max-age=86400');
};
