import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { seriesBackdrop } from '#lib/server/library/backdrop.ts';
import { log } from '#lib/server/log.ts';
import { CORS, musicPassOf, withCors } from '#lib/server/media-api.ts';

/** The video API (#253): the image behind the top of a series' page, by the pass. */
export const GET: RequestHandler = async ({ params, request }) => {
	musicPassOf(params.token);
	let file;
	try {
		file = await seriesBackdrop(Number(params.id));
	} catch (problem) {
		log.warn('fondos', 'No se pudo sacar el fondo de una serie', {
			seriesId: params.id,
			error: problem
		});
		error(500, 'No se pudo sacar el fondo');
	}
	if (!file) error(404, 'Sin fondo');
	return withCors(await fileResponse(request, file, 'image/jpeg', 'private, no-cache'));
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
