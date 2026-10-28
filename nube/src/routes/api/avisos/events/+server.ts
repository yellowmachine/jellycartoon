import type { RequestHandler } from './$types';
import { watchAlarms } from '#lib/server/alarms/alarms.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';

/**
 * The family's alarms (#241), live: a ping on every change (one set, ringing, stopped), for the
 * page to load them again with what it may see.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	return sseResponse<number>(request, (listener) =>
		watchAlarms(k.familyId, () => listener(Date.now()))
	);
};
