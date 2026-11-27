import type { RequestHandler } from './$types';
import { satelliteBeat, satellitePageSaid, satelliteRequest } from '#lib/server/satellites.ts';

/**
 * A satellite's beat, every minute (#469): there, for «Compañía». Its channel of notices alone does
 * not say so: a Pi unplugged at once leaves it open here for many minutes. With it, its page of
 * devices in the home's network (#643), for Enchufes' link.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { satellite } = await satelliteRequest(request);
	satelliteBeat(satellite.id);
	const body = (await request.json().catch(() => null)) as { alta?: unknown } | null;
	satellitePageSaid(satellite.id, body?.alta);
	return new Response(null, { status: 204 });
};
