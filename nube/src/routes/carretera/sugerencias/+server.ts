import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { LngLat } from 'comun/road.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';

/**
 * Suggestions as the road mode's destination is typed (#253; jellycartoon's #78): `q`, and
 * `lon`/`lat` for the nearest.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const q = url.searchParams.get('q')?.trim().slice(0, 200);
	if (!q || q.length < 3) return json([]);
	const lon = Number(url.searchParams.get('lon'));
	const lat = Number(url.searchParams.get('lat'));
	const near: LngLat | null =
		url.searchParams.has('lon') && Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
	const { suggestPlaces, orsMessage } = orsFor(await kitchenOf(locals.user!.id));
	try {
		return json(await suggestPlaces(q, near));
	} catch (err) {
		error(502, orsMessage(err, 'sugerir sitios'));
	}
};
