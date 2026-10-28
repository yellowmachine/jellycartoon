import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ORIGIN } from '$app/env/private';
import { allEvents, familyOfIcs } from '#lib/server/agenda/agenda.ts';
import { toIcs } from '#lib/server/agenda/ics.ts';
import { houseKitchen } from '#lib/server/fridge.ts';

/**
 * The family's agenda (#200) for a phone's calendar, read only: without a session, as a calendar
 * asks, so with the family's secret in the link (in the Agenda, where it can be changed).
 */
export const GET: RequestHandler = async ({ params }) => {
	const familyId = await familyOfIcs(params.token);
	if (!familyId) error(404, 'No encontrado');
	const body = toIcs(await allEvents(houseKitchen(familyId)), {
		host: new URL(ORIGIN).hostname,
		zone: Intl.DateTimeFormat().resolvedOptions().timeZone
	});
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': 'inline; filename="agenda.ics"',
			'cache-control': 'no-cache'
		}
	});
};
