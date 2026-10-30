import type { RequestHandler } from './$types';
import { hlsFile } from '#lib/server/hls-files.ts';
import { videoAllowed } from '#lib/server/kid-time.ts';
import { CORS, grantOf, withCors } from '#lib/server/media-api.ts';

/**
 * The video API (#253): an episode's HLS, by the signed link the cloud was given. A child's, out
 * of its times (#303, as at home: kid-time.ts), refused: what is playing stops within seconds.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const grant = grantOf(params.token);
	if (!(await videoAllowed(grant.userId)).allowed)
		return withCors(new Response('Ahora no toca ver vídeos', { status: 403 }));
	return withCors(
		await hlsFile(request, url, grant.episodeId, params.file, {
			lightOnly: grant.quality === 'light'
		})
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
