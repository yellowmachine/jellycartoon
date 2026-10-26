import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ORIGIN } from '$app/env/private';
import { allEvents, isIcsToken } from '#lib/server/agenda/agenda.ts';
import { toIcs } from '#lib/server/agenda/ics.ts';

/**
 * The agenda (#200) for a phone's calendar, read only: without a session, as a calendar asks, so
 * with the house's secret in the link (Ajustes of the agenda, where it can be changed).
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!(await isIcsToken(params.token))) error(404, 'No encontrado');
	const body = toIcs(await allEvents(), {
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
