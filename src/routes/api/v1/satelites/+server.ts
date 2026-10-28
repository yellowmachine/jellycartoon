import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fromCloud } from '#lib/server/media-api.ts';
import { allSatellites } from '#lib/server/satellites.ts';

/** The house's voice satellites, for the cloud's alarms (#253): where one can sound too. */
export const GET: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	return json({ satellites: (await allSatellites()).map((s) => ({ id: s.id, name: s.name })) });
};
