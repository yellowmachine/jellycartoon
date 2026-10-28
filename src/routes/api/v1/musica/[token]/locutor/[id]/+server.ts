import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';
import { clipFile, isClipId } from '#lib/server/music/dj.ts';

/** The music API (#253): what the DJ said between two songs (Modo DJ), as Opus, by the pass. */
export const GET: RequestHandler = async ({ params, request }) => {
	musicPassOf(params.token);
	if (!isClipId(params.id)) error(404, 'No encontrado');
	return withCors(
		await fileResponse(request, clipFile(params.id), 'audio/ogg', 'private, max-age=43200')
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
