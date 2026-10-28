import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { addTripPoints, recordsTrips } from '#lib/server/trips/trips.ts';
import type { TripPoint } from '#lib/trips.ts';

/** A batch of positions at most: ~25 m apart, half an hour of motorway. */
const MAX_POINTS = 2000;

const isPoint = (p: unknown): p is TripPoint => {
	const q = p as TripPoint | null;
	return (
		typeof q?.t === 'number' &&
		Number.isFinite(q.t) &&
		Array.isArray(q.at) &&
		q.at.length === 2 &&
		q.at.every(Number.isFinite) &&
		Math.abs(q.at[0]) <= 180 &&
		Math.abs(q.at[1]) <= 90 &&
		(q.speed === null || (typeof q.speed === 'number' && Number.isFinite(q.speed)))
	);
};

/**
 * The road mode's positions (#81), every half a minute, for whoever keeps their trips: `points`,
 * and the route's `destination` if there is one. Without that setting, nothing is kept.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	if (!(await recordsTrips(k))) return json({ kept: false });
	const body = await request.json().catch(() => null);
	const points = Array.isArray(body?.points)
		? body.points.filter(isPoint).slice(0, MAX_POINTS)
		: null;
	if (!points) error(400, 'Faltan las posiciones');
	const destination =
		typeof body.destination === 'string' && body.destination.trim()
			? body.destination.trim().slice(0, 200)
			: null;
	await addTripPoints(k, points, destination);
	return json({ kept: true });
};
