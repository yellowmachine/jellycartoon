import type { RequestHandler } from './$types';
import { trackFile } from '#lib/server/music/track-file.ts';

/** A track's file; `?format=opus`, its Opus copy (track-file.ts). */
export const GET: RequestHandler = ({ params, request, url }) =>
	trackFile(request, Number(params.id), { opus: url.searchParams.get('format') === 'opus' });
