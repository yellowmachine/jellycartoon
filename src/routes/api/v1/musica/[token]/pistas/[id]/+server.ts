import type { RequestHandler } from './$types';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';
import { trackFile } from '#lib/server/music/track-file.ts';

/** The music API (#253): a track, by the pass, in its Opus copy (for mobile data). */
export const GET: RequestHandler = async ({ params, request }) => {
	musicPassOf(params.token);
	return withCors(await trackFile(request, Number(params.id), { opus: true }));
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
