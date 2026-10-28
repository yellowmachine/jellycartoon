import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { tripLine } from '#lib/server/trips/trips.ts';
import { listPhotos } from '#lib/server/trips/photos.ts';

/** A trip's positions (#81), to draw it when it is opened, and its photos: only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const k = await kitchenOf(locals.user!.id);
	const line = await tripLine(k, id);
	if (!line) error(404, 'Viaje no encontrado');
	const photos = await listPhotos(k, id);
	return json({ line, photos: photos.filter((p) => p.lon !== null && p.lat !== null) });
};
