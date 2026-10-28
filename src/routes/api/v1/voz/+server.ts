import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromCloud } from '#lib/server/media-api.ts';
import { runHand } from '#lib/server/voice/hands.ts';

/**
 * One of the house's tools for an order going on (#253): the cloud's AI asks for it (play this
 * in the living room, a satellite's timer…), in that order's name, which the house sent it. Back,
 * what to tell the AI and what the device must do; a 404 once the order is over.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	const body = await request.json().catch(() => null);
	const args = body?.args ?? {};
	if (typeof body?.order !== 'string' || typeof body.name !== 'string' || typeof args !== 'object')
		error(400, 'Petición no válida');
	const done = await runHand(body.order, body.name, args);
	if (!done) error(404, 'Esa orden ya ha terminado');
	return json(done);
};
