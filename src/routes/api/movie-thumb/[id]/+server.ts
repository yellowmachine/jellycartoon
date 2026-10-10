import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { movieThumbFile } from '#lib/server/library/paths.ts';

// Revalidated every time (a 304 when unchanged), like episode thumbnails.
export const GET: RequestHandler = ({ params, request }) =>
	fileResponse(request, movieThumbFile(Number(params.id)), 'image/jpeg', 'private, no-cache');
