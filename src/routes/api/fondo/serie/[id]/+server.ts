import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { chooseSeriesBackdrop, seriesBackdrop } from '#lib/server/library/backdrop.ts';
import { log } from '#lib/server/log.ts';

/**
 * The image behind the top of a series' page: made the first time (a few seconds), then kept.
 * Revalidated every time (a 304 when unchanged), so a new one shows up everywhere at once.
 */
export const GET: RequestHandler = async ({ params, request }) => {
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
	return fileResponse(request, file, 'image/jpeg', 'private, no-cache');
};

/** Back to the app's choice (`{ auto: true }`). A frame is chosen from the player (capitulo/[id]). */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	if (body?.auto !== true) error(400, 'Bad request');
	try {
		if (!(await chooseSeriesBackdrop(Number(params.id), null))) error(404, 'Sin fondo');
	} catch (problem) {
		if ((problem as { status?: number })?.status) throw problem;
		log.warn('fondos', 'No se pudo cambiar el fondo de una serie', {
			seriesId: params.id,
			error: problem
		});
		error(500, 'No se pudo sacar el fondo');
	}
	return json({ ok: true });
};
