import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { syncOfflineGames } from '#lib/server/games-offline.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { isDeviceId } from 'comun/route-maps.ts';

/**
 * The device that carries games without coverage, as the app opens on it: `{ id }`. Back, the
 * games it carries with what their player needs as it is now; 404, it was forgotten from another
 * device; 502, the house does not answer (it keeps what it has).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!isDeviceId(body?.id)) error(400, 'Bad request');
	const who = { id: locals.user!.id, email: locals.user!.email };
	let games;
	try {
		games = await syncOfflineGames(await kitchenOf(who.id), who, body.id);
	} catch (problem) {
		if (problem instanceof HouseProblem) error(502, problem.message);
		throw problem;
	}
	if (!games) error(404, 'Dispositivo olvidado');
	return json({ games });
};
