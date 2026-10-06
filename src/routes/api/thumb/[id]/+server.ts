import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { thumbFile } from '#lib/server/library/paths.ts';

export const GET: RequestHandler = ({ params, request }) =>
	fileResponse(request, thumbFile(Number(params.id)), 'image/jpeg');
