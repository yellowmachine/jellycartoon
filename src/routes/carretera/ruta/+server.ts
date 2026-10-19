import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { LngLat } from '#lib/road.ts';
import { drivingRoute, orsMessage } from '#lib/server/road/ors.ts';

const isLngLat = (value: unknown): value is LngLat =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every(Number.isFinite) &&
	Math.abs(value[0]) <= 180 &&
	Math.abs(value[1]) <= 90;

/** The road mode's route (#78): by car from `from` (where we are) to `to`, with its steps. */
export const POST: RequestHandler = async ({ request }) => {
	const { from, to } = await request.json().catch(() => ({}));
	if (!isLngLat(from) || !isLngLat(to)) error(400, 'Faltan el origen o el destino');
	try {
		return json(await drivingRoute(from, to));
	} catch (err) {
		error(502, orsMessage(err, 'calcular la ruta'));
	}
};
