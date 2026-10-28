import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { personOf } from '#lib/server/agenda/agenda.ts';
import { canTouch, stopAlarm } from '#lib/server/alarms/alarms.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/** «Parar», from the banner on any page (#241): one this person sees. The house stops it too. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await canTouch(k, id, await personOf(k, locals.user!.id))))
		error(404, 'No encontrado');
	await stopAlarm(k, id);
	return new Response(null, { status: 204 });
};
