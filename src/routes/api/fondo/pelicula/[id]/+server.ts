import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from 'comun/server/file-response.ts';
import { chooseFilmBackdrop, filmBackdrop } from '#lib/server/library/backdrop.ts';
import { log } from '#lib/server/log.ts';

/**
 * The image behind the top of a film's page: made the first time (a few seconds), then kept.
 * Revalidated every time (a 304 when unchanged), so a new one shows up everywhere at once.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	let file;
	try {
		file = await filmBackdrop(Number(params.id));
	} catch (problem) {
		log.warn('fondos', 'No se pudo sacar el fondo de una película', {
			movieId: params.id,
			error: problem
		});
		error(500, 'No se pudo sacar el fondo');
	}
	if (!file) error(404, 'Sin fondo');
	return fileResponse(request, file, 'image/jpeg', 'private, no-cache');
};

/** `{ atSec }`: that frame from now on. `{ auto: true }`: back to the app's choice. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const atSec =
		body?.auto === true
			? null
			: typeof body?.atSec === 'number' && body.atSec >= 0
				? (body.atSec as number)
				: undefined;
	if (atSec === undefined) error(400, 'Bad request');
	try {
		if (!(await chooseFilmBackdrop(Number(params.id), atSec))) error(404, 'Sin fondo');
	} catch (problem) {
		if ((problem as { status?: number })?.status) throw problem;
		log.warn('fondos', 'No se pudo cambiar el fondo de una película', {
			movieId: params.id,
			error: problem
		});
		error(500, 'No se pudo sacar el fondo');
	}
	return json({ ok: true });
};
