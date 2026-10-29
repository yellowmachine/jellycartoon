import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopRingingAt } from '#lib/server/alarms/alarms.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/** Its wake word while something rings where it is (#296): it stops, as a touch does. */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	return json({ stopped: await stopRingingAt(k, `satelite:${satellite.id}`) });
};
