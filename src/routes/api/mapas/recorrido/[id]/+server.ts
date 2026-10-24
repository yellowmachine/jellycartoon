import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { prepareRouteMap } from '#lib/server/route-maps.ts';
import { isDeviceId } from '#lib/route-maps.ts';

/**
 * A route's map, ready to download (#164): cut the first time (some seconds). Back, its address
 * under /mapa (read by pieces, so a download cut short goes on), size and version. `{ device }`:
 * the device it was ordered for, which may not be its owner's.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'Bad request');
	let prepared;
	try {
		prepared = await prepareRouteMap(
			locals.user!.id,
			id,
			isDeviceId(body?.device) ? body.device : null
		);
	} catch (problem) {
		log.warn('mapas', 'No se pudo recortar el mapa de un recorrido', { route: id, error: problem });
		error(500, 'No se pudo recortar el mapa');
	}
	if (!prepared) error(404, 'No encontrado');
	return json(prepared);
};
