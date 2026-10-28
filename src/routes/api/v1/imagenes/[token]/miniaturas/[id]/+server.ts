import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { thumbFile } from '#lib/server/library/paths.ts';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';

/** The video API (#253): an episode's thumbnail, by the pass, for the cloud's pages. */
export const GET: RequestHandler = async ({ params, request }) => {
	musicPassOf(params.token);
	return withCors(
		await fileResponse(request, thumbFile(Number(params.id)), 'image/jpeg', 'private, no-cache')
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
