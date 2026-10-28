import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { quietFromCloud } from '#lib/server/alarms/alarms.ts';
import { fromCloud } from '#lib/server/media-api.ts';

/** One of the family's alarms stopped in the cloud (#253), or gone there: quiet here too. */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	const id = Number((await request.json().catch(() => null))?.id);
	if (!Number.isInteger(id)) error(400, 'Aviso no válido');
	await quietFromCloud(id);
	return json({ ok: true });
};
