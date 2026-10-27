import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canTouch, stopAlarm } from '#lib/server/alarms/alarms.ts';

/** «Parar», from the banner on any page (#241): one this person sees. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(404, 'No encontrado');
	const id = Number(params.id);
	if (!Number.isInteger(id) || !(await canTouch(id, locals.user.id))) error(404, 'No encontrado');
	await stopAlarm(id);
	return new Response(null, { status: 204 });
};
