import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { isSteamPicture, steamPictureFile } from '#lib/server/steam.ts';

/** A Steam game's picture, from Steam's own library cache on the PC with the screen. */
export const GET: RequestHandler = async ({ params, request }) => {
	const appid = Number(params.appid);
	if (!Number.isInteger(appid) || !isSteamPicture(params.picture)) error(404, 'No encontrada');
	const file = await steamPictureFile(appid, params.picture);
	if (!file) error(404, 'No encontrada');
	const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
	return fileResponse(request, file, type, 'private, max-age=86400');
};
