import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { pictureFile, PICTURES, type Picture } from '#lib/server/games.ts';

/** One of a game's pictures (#176): libretro's, or the one taken while playing. */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!PICTURES.includes(params.kind as Picture)) error(404, 'No encontrada');
	const file = pictureFile(Number(params.id), params.kind as Picture);
	return fileResponse(request, file, 'image/png', 'private, max-age=86400');
};
