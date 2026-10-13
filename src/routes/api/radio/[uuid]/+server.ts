import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { streamFor } from '#lib/server/radio.ts';

/** The stream of one of our stations, to play it now. */
export const GET: RequestHandler = async ({ params }) => {
	let stream;
	try {
		stream = await streamFor(params.uuid);
	} catch (err) {
		error(503, `No se pudo consultar Radio Browser: ${err instanceof Error ? err.message : err}`);
	}
	if (!stream) error(404, 'Emisora no encontrada');
	return json(stream);
};
