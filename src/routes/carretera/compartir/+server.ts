import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { startSharing, stopSharing, updateSharing } from '#lib/server/trip-share.ts';

const num = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Sharing the trip (#81), from the road mode: `start` (its link back), `update` (where we are, the
 * destination and the arrival) and `stop`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const body = await request.json().catch(() => null);

	if (body?.action === 'start') {
		try {
			return json({ url: await startSharing(userId, locals.user!.name.split(' ')[0] ?? '') });
		} catch (err) {
			log.warn('viajes', 'No se pudo compartir el viaje', { error: err });
			error(502, err instanceof Error ? err.message : 'No se pudo compartir el viaje');
		}
	}

	if (body?.action === 'stop') {
		await stopSharing(userId);
		return json({ sharing: false });
	}

	if (body?.action !== 'update') error(400, 'Orden no válida');
	const p = body.position;
	const lon = num(p?.lon);
	const lat = num(p?.lat);
	const position =
		lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
			? { lon, lat, t: num(p.t) ?? Date.now(), speed: num(p.speed), heading: num(p.heading) }
			: null;
	const destination =
		typeof body.destination === 'string' && body.destination.trim()
			? body.destination.trim().slice(0, 200)
			: null;
	return json({
		sharing: await updateSharing(userId, { position, destination, arrivesAt: num(body.arrivesAt) })
	});
};
