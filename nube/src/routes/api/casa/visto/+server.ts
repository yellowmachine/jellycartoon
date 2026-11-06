import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { forgetWatched, parseWatchRows, saveWatched } from '#lib/server/watch-log.ts';

/**
 * What the house says someone watched (#421), in their name (`x-persona`): the seconds of each slot
 * (`save`), or to forget all that was sent (`forget`). `known: false`: not one of the family here,
 * so nothing was kept, and the house need not send it again.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const action = body?.action;
	if (action !== 'save' && action !== 'forget') error(400, 'Petición no válida');
	const rows = action === 'save' ? parseWatchRows(body.rows) : [];
	if (!rows) error(400, 'Petición no válida');
	if (!k.userId) return json({ known: false });
	if (action === 'forget') await forgetWatched(k, k.userId);
	else await saveWatched(k, k.userId, rows);
	return json({ known: true });
};
