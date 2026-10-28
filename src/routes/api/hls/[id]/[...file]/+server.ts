import type { RequestHandler } from './$types';
import { hlsFile } from '#lib/server/hls-files.ts';

export const GET: RequestHandler = ({ params, request, url }) =>
	hlsFile(request, url, Number(params.id), params.file);
