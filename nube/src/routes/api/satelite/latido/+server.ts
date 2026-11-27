import type { RequestHandler } from './$types';
import {
	satelliteBeat,
	satelliteKept,
	satellitePageSaid,
	satelliteRequest
} from '#lib/server/satellites.ts';

/**
 * A satellite's beat, every minute (#469): there, for «Compañía». Its channel of notices alone does
 * not say so: a Pi unplugged at once leaves it open here for many minutes. With it, its page of
 * devices in the home's network (#643), for Enchufes' link; and its key's fingerprint and the
 * version of the plug rules it keeps (#651).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	satelliteBeat(satellite.id);
	const body = (await request.json().catch(() => null)) as {
		alta?: unknown;
		fp?: unknown;
		reglas?: unknown;
	} | null;
	satellitePageSaid(satellite.id, body?.alta);
	await satelliteKept(k, satellite.id, body?.fp, body?.reglas);
	return new Response(null, { status: 204 });
};
