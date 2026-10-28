import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tripLine } from '#lib/server/trips.ts';
import { listPhotos } from '#lib/server/trip-photos.ts';

/** A trip's positions (#81), to draw it when it is opened, and its photos: only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const line = await tripLine(locals.user!.id, id);
	if (!line) error(404, 'Viaje no encontrado');
	const photos = await listPhotos(locals.user!.id, id);
	return json({ line, photos: photos.filter((p) => p.lon !== null && p.lat !== null) });
};
