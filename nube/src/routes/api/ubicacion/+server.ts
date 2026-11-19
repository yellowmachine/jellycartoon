import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isLngLat } from 'comun/road.ts';
import { sendLocation } from '#lib/server/location-share.ts';
import { sharing } from '#lib/server/trips/share.ts';

/**
 * «Manda mi ubicación a mamá» (#550), by voice or by hand: `{ to, at: [lon, lat] }` where one is
 * now, or `{ to, live: true }` the trip being shared (#81) from this browser, already started.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const body = await request.json().catch(() => null);
	if (typeof body?.to !== 'string') error(400, 'A quién no válido');
	let result;
	if (body.live === true) {
		const url = sharing(userId);
		if (!url) error(409, 'No estás compartiendo el viaje');
		result = await sendLocation(userId, body.to, { kind: 'viaje', url });
	} else {
		const at = body.at;
		if (!isLngLat(at)) error(400, 'Sin posición: ¿le has dado permiso de ubicación?');
		result = await sendLocation(userId, body.to, { kind: 'aqui', at });
	}
	if ('problem' in result) error(400, result.problem);
	return json(result);
};
