import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncMapDevice } from '#lib/server/route-maps.ts';
import { isDeviceId, type HeldMap } from '#lib/route-maps.ts';

/**
 * The device that keeps routes' maps (#164), as the app opens on it: `{ id, held }`, what it has
 * whole. Back, what it has to do; 404, it was forgotten from another device.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const held: HeldMap[] = Array.isArray(body?.held)
		? body.held.filter(
				(h: HeldMap) =>
					Number.isInteger(h?.routeId) && typeof h.version === 'string' && Number.isFinite(h.bytes)
			)
		: [];
	if (!isDeviceId(body?.id)) error(400, 'Bad request');
	const sync = await syncMapDevice(body.id, held);
	if (!sync) error(404, 'Dispositivo olvidado');
	return json(sync);
};
