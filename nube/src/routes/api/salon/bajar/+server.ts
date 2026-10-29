import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { familyHasHouse, tellHouse } from '#lib/server/house.ts';
import { satelliteRequest, snapclientIdOf, snapserverOf } from '#lib/server/satellites.ts';

/**
 * The living room lowered while someone speaks to a satellite of Seilide's (#296), the house's path
 * (its /api/salon/bajar): asked of the house (its /api/v1/salon/bajar), with its own snapclient as
 * its room's speaker if it plays the house's music. Without a house, nothing to lower.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const { on } = await request.json().catch(() => ({}));
	if (typeof on !== 'boolean' || !(await familyHasHouse(k.familyId))) return json({ ok: false });
	const speaker = (await snapserverOf(k, satellite.id)) ? snapclientIdOf(satellite.id) : null;
	await tellHouse(k.familyId, '/salon/bajar', { on, speaker }).catch((err) =>
		console.warn(`[voz] ${satellite.name}: la tele no se ha bajado`, String(err))
	);
	return json({ ok: true });
};
