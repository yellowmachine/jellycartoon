import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isDay, isTime } from 'comun/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { markDose } from '#lib/server/medication.ts';

/**
 * «✓ Tomada» in a dose's notice (#308), from the service worker with the session's cookie: that
 * dose, marked by whoever's phone it is. A child cannot (hooks.server.ts).
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	const day = url.searchParams.get('dia');
	const time = url.searchParams.get('hora');
	if (!isDay(day) || !isTime(time)) error(400, 'Toma no válida');
	const k = await kitchenOf(locals.user!.id);
	if (!(await markDose(k, Number(url.searchParams.get('id')), day, time, true)))
		error(404, 'Esa toma ya no está');
	return new Response(null, { status: 204 });
};
