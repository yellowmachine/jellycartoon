import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelHouseTimer, houseTimers } from '#lib/server/alarms/alarms.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { familySatellites } from '#lib/server/satellites.ts';

/**
 * The whole house's timers (#557: a rule's «sacar las bebidas del congelador»), for the Vista:
 * those counting or ringing, and whether it should ring them itself (no satellites to do it).
 */
export const GET: RequestHandler = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [timers, satellites] = await Promise.all([houseTimers(k), familySatellites(k.familyId)]);
	return json({ timers, ringHere: !satellites.length });
};

/** One taken away from the Vista (its ×), counting or ringing: everywhere. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const id = Number((await request.json().catch(() => null))?.id);
	if (!Number.isInteger(id) || !(await cancelHouseTimer(k, id))) error(404, 'No está');
	return new Response(null, { status: 204 });
};
