import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopRingingAt } from '#lib/server/alarms/alarms.ts';

/** «Hola casita» while something rings where the satellite is (#241): it stops, as a touch does. */
export const POST: RequestHandler = async ({ locals }) => {
	const satellite = locals.satellite;
	if (!satellite) error(404, 'No encontrado');
	return json({ stopped: await stopRingingAt(`satelite:${satellite.id}`) });
};
