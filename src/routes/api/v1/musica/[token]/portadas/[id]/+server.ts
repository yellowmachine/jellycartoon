import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { albumCoverFile } from '#lib/server/library/paths.ts';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';

/** The music API (#253): an album's cover, by the pass. */
export const GET: RequestHandler = async ({ params, request }) => {
	musicPassOf(params.token);
	return withCors(
		await fileResponse(
			request,
			albumCoverFile(Number(params.id)),
			'image/jpeg',
			'private, max-age=86400'
		)
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
