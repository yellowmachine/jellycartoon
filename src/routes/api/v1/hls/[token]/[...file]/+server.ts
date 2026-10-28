import type { RequestHandler } from './$types';
import { hlsFile } from '#lib/server/hls-files.ts';
import { CORS, grantOf, withCors } from '#lib/server/media-api.ts';

/** The video API (#253): an episode's HLS, by the signed link the cloud was given. */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const grant = grantOf(params.token);
	return withCors(
		await hlsFile(request, url, grant.episodeId, params.file, {
			lightOnly: grant.quality === 'light'
		})
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
