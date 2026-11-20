import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { reportSession } from '#lib/server/own-games.ts';

/**
 * The seconds played since the last report (#564): every half minute, and when leaving the game
 * (with navigator.sendBeacon, which only POSTs).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { seconds } = await request.json().catch(() => ({}));
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) error(400, 'Faltan los segundos');
	const { familyId } = await kitchenOf(locals.user!.id);
	if (!(await reportSession(familyId, locals.user!.id, Number(params.id), seconds)))
		error(404, 'Sesión no encontrada');
	return json({ ok: true });
};
