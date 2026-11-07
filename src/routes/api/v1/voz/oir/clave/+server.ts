import { BETTER_AUTH_SECRET } from '$app/env/private';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromCloud } from '#lib/server/media-api.ts';
import { hearingKey } from '#lib/server/voice/hearing-key.ts';

/** For the cloud to give a satellite of its own (#430): the key to /voz/oir, and to nothing else. */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	const body = await request.json().catch(() => null);
	const satellite = typeof body?.satellite === 'string' ? body.satellite.trim() : '';
	if (!satellite || satellite.length > 100) error(400, 'Falta el satélite');
	return json({ key: hearingKey(BETTER_AUTH_SECRET, satellite) });
};
