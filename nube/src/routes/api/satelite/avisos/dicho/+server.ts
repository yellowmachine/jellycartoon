import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saidOn, satelliteRequest } from '#lib/server/satellites.ts';

/** What it was to say once (#331), said: not again. */
export const POST: RequestHandler = async ({ request }) => {
	const { satellite } = await satelliteRequest(request);
	const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
	if (typeof id !== 'string') error(400, 'Falta cuál');
	saidOn(satellite.id, id);
	return json({ ok: true });
};
