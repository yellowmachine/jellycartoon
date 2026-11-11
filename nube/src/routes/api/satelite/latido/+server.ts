import type { RequestHandler } from './$types';
import { satelliteBeat, satelliteRequest } from '#lib/server/satellites.ts';

/**
 * A satellite's beat, every minute (#469): there, for «Compañía». Its channel of notices alone does
 * not say so: a Pi unplugged at once leaves it open here for many minutes.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { satellite } = await satelliteRequest(request);
	satelliteBeat(satellite.id);
	return new Response(null, { status: 204 });
};
