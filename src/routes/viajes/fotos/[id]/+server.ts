import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { photoFile } from '#lib/server/library/paths.ts';
import { ownsPhoto } from '#lib/server/trip-photos.ts';

/** A road mode's photo (#81): only for whoever took it. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await ownsPhoto(locals.user!.id, id))) error(404, 'No encontrada');
	return fileResponse(request, photoFile(id), 'image/jpeg', 'private, max-age=86400');
};
