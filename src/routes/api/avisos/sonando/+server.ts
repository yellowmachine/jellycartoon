import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAlarms, placeName } from '#lib/server/alarms/alarms.ts';
import { allSatellites } from '#lib/server/satellites.ts';

/**
 * The alarms and timers ringing now (#241) that this person sees (the house's and theirs), for the
 * banner on every page: what, and where it sounds.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(404, 'No encontrado');
	const [alarms, satellites] = await Promise.all([listAlarms(locals.user.id), allSatellites()]);
	return json(
		alarms
			.filter((a) => a.ringingSince !== null)
			.map((a) => ({ id: a.id, label: a.label, where: placeName(a.place, satellites) }))
	);
};
