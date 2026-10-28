import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { LngLat } from 'comun/road.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';

/**
 * Places for the road mode's destination (#253; jellycartoon's #78): `q`, and `lon`/`lat` to find
 * the nearest first.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const q = url.searchParams.get('q')?.trim().slice(0, 200);
	if (!q) error(400, 'Falta qué buscar');
	const lon = Number(url.searchParams.get('lon'));
	const lat = Number(url.searchParams.get('lat'));
	const near: LngLat | null =
		url.searchParams.has('lon') && Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
	const { searchPlaces, orsMessage } = orsFor(await kitchenOf(locals.user!.id));
	try {
		return json(await searchPlaces(q, near));
	} catch (err) {
		error(502, orsMessage(err, 'buscar el sitio'));
	}
};
