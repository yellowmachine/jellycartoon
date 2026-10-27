import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { watchAlarms } from '#lib/server/alarms/alarms.ts';
import { sseResponse } from '#lib/server/sse.ts';

/**
 * The Agenda's alarms and timers (#241), live: a ping on every change (one set, ringing, stopped),
 * for the page to load them again with what it may see.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(404, 'No encontrado');
	return sseResponse<number>(request, (listener) => watchAlarms(() => listener(Date.now())));
};
