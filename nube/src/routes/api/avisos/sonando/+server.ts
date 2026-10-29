import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { personOf } from '#lib/server/agenda/agenda.ts';
import { listAlarms, placeName } from '#lib/server/alarms/alarms.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { allSatellites } from '#lib/server/satellites.ts';

/**
 * The alarms ringing now (#241) that this person sees (the house's and theirs), for the banner on
 * every page: what, and where it sounds. The satellites (Seilide's and the house's), only if one rings in one.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const ringing = (await listAlarms(k, await personOf(k, locals.user!.id))).filter(
		(a) => a.ringingSince !== null
	);
	const satellites = ringing.some((a) => a.place !== 'casa') ? await allSatellites(k.familyId) : [];
	return json(
		ringing.map((a) => ({ id: a.id, label: a.label, where: placeName(a.place, satellites) }))
	);
};
