import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { addTripPoints, recordsTrips } from '#lib/server/trips/trips.ts';
import { isTripPoint } from '#lib/trips.ts';

/** A batch of positions at most: ~25 m apart, half an hour of motorway. */
const MAX_POINTS = 2000;

/**
 * The road mode's positions (#81), every half a minute, for whoever keeps their trips: `points`,
 * and the route's `destination` if there is one. Without that setting, nothing is kept.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	if (!(await recordsTrips(k))) return json({ kept: false });
	const body = await request.json().catch(() => null);
	const points = Array.isArray(body?.points)
		? body.points.filter(isTripPoint).slice(0, MAX_POINTS)
		: null;
	if (!points) error(400, 'Faltan las posiciones');
	const destination =
		typeof body.destination === 'string' && body.destination.trim()
			? body.destination.trim().slice(0, 200)
			: null;
	await addTripPoints(k, points, destination);
	return json({ kept: true });
};
