import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isLngLat } from '#lib/road.ts';
import { MAX_STOPS } from '#lib/saved-places.ts';
import { drivingRoute, orsMessage } from '#lib/server/road/ors.ts';

/**
 * The road mode's route (#78): by car from `from` (where we are) to `to`, with its steps; through
 * `via` first, a kept route's stops ahead (#151).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { from, to, via = [] } = await request.json().catch(() => ({}));
	if (!isLngLat(from) || !isLngLat(to)) error(400, 'Faltan el origen o el destino');
	if (!Array.isArray(via) || via.length > MAX_STOPS || !via.every(isLngLat))
		error(400, 'Paradas no válidas');
	try {
		return json(await drivingRoute([from, ...via, to]));
	} catch (err) {
		error(502, orsMessage(err, 'calcular la ruta'));
	}
};
