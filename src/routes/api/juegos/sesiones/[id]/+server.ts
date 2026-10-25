import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reportSession } from '#lib/server/game-sessions.ts';

/**
 * The seconds played since the last report: every half minute, and when leaving the game (with
 * navigator.sendBeacon, which only POSTs).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { seconds } = await request.json().catch(() => ({}));
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) error(400, 'Faltan los segundos');
	if (!(await reportSession(locals.user!.id, Number(params.id), seconds)))
		error(404, 'Sesión no encontrada');
	return json({ ok: true });
};
