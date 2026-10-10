import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FRAME_WIDTHS } from '#lib/birds-eye.ts';
import { movieFrame } from '#lib/server/cinema/frames.ts';
import { log } from '#lib/server/log.ts';

/** A frame of the film, made when asked for and not saved: the browser keeps it for a day. */
export const GET: RequestHandler = async ({ params, url }) => {
	const movieId = Number(params.id);
	const atSec = Number(params.at);
	const width = Number(url.searchParams.get('w') ?? FRAME_WIDTHS[0]);
	if (!Number.isInteger(atSec) || atSec < 0) error(400, 'Momento no válido');
	if (!FRAME_WIDTHS.includes(width as (typeof FRAME_WIDTHS)[number]))
		error(400, 'Tamaño no válido');

	let jpeg;
	try {
		jpeg = await movieFrame(movieId, atSec, width);
	} catch (err) {
		log.warn('cine', `No se pudo sacar el fotograma del segundo ${atSec}`, { movieId, error: err });
		error(500, 'No se pudo sacar el fotograma');
	}
	if (!jpeg) error(404, 'Película no encontrada');
	return new Response(new Uint8Array(jpeg), {
		headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
	});
};
