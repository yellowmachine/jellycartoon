import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { albumCoverFile } from '#lib/server/library/paths.ts';

export const GET: RequestHandler = ({ params, request }) =>
	fileResponse(request, albumCoverFile(Number(params.id)), 'image/jpeg', 'private, max-age=86400');
