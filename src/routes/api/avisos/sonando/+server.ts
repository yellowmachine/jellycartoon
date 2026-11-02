import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAlarms, placeName } from '#lib/server/alarms/alarms.ts';

/**
 * The alarms and timers ringing now (#241) that this person sees (the house's and theirs), for the
 * banner on every page: what, and where it sounds.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(404, 'No encontrado');
	const alarms = await listAlarms(locals.user.id);
	return json(
		alarms
			.filter((a) => a.ringingSince !== null)
			.map((a) => ({ id: a.id, label: a.label, where: placeName(a.place) }))
	);
};
