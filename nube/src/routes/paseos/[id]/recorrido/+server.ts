import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { walkLine } from '#lib/server/walks/walks.ts';

/** A walk's positions (#410), to draw it when it is opened: only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Paseo no encontrado');
	const line = await walkLine(await kitchenOf(locals.user!.id), id);
	if (!line) error(404, 'Paseo no encontrado');
	return json({ line });
};
