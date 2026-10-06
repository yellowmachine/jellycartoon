import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { videoFile } from '#lib/server/library/paths.ts';

export const GET: RequestHandler = ({ params, request }) =>
	fileResponse(request, videoFile(Number(params.id)), 'video/mp4');

export const HEAD = GET;
