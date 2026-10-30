import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isDay, isTime } from 'comun/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { markDose } from '#lib/server/medication.ts';

/**
 * «✓ Tomada» in a notice (#308), from the service worker with the session's cookie: its doses
 * (one person's at one time, `id` once for each), marked by whoever's phone it is. A child cannot
 * (hooks.server.ts).
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	const day = url.searchParams.get('dia');
	const time = url.searchParams.get('hora');
	if (!isDay(day) || !isTime(time)) error(400, 'Toma no válida');
	const k = await kitchenOf(locals.user!.id);
	const ids = url.searchParams.getAll('id').map(Number);
	if (!ids.length) error(400, 'Toma no válida');
	let marked = 0;
	for (const id of ids) if (await markDose(k, id, day, time, true)) marked++;
	if (!marked) error(404, 'Esa toma ya no está');
	return new Response(null, { status: 204 });
};
