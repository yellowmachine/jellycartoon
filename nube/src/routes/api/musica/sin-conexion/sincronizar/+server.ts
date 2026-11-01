import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { syncOffline } from '#lib/server/music-offline.ts';
import { isDeviceId } from 'comun/route-maps.ts';

/**
 * The device that carries music without coverage (#350), as the app opens on it: `{ id }`. Back,
 * the lists it carries with their songs as they are now; 404, it was forgotten from another device;
 * 502, the house does not answer (it keeps what it has).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!isDeviceId(body?.id)) error(400, 'Bad request');
	const who = { id: locals.user!.id, email: locals.user!.email };
	let lists;
	try {
		lists = await syncOffline(await kitchenOf(who.id), who, body.id);
	} catch (problem) {
		if (problem instanceof HouseProblem) error(502, problem.message);
		throw problem;
	}
	if (!lists) error(404, 'Dispositivo olvidado');
	return json({ lists });
};
