import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { clipFile, djEnabled, isClipId } from '#lib/server/music/dj.ts';

/** What the DJ said between two songs (Modo DJ), as Opus. */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!djEnabled || !isClipId(params.id)) error(404, 'No encontrado');
	return fileResponse(request, clipFile(params.id), 'audio/ogg', 'private, max-age=43200');
};
