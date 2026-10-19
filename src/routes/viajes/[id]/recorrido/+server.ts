import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tripLine } from '#lib/server/trips.ts';

/** A trip's positions (#81), to draw it when it is opened: only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const line = await tripLine(locals.user!.id, Number(params.id));
	if (!line) error(404, 'Viaje no encontrado');
	return json(line);
};
