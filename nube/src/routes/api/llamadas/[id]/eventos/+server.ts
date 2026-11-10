import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseDevice, type CallEvent } from '#lib/calls.ts';
import { calls } from '#lib/server/calls.ts';
import { sseResponse } from '#lib/server/sse.ts';

/**
 * One side's page, listening to its call (#330), as one of their devices (`aparato`): how it is,
 * and the other's signals. A call that is over, or not theirs, answers 404, and the page says so.
 */
export const GET: RequestHandler = async ({ request, params, locals, url }) => {
	const userId = locals.user!.id;
	const device = parseDevice(url.searchParams.get('aparato'));
	if (!device) error(400, 'Desde qué aparato');
	if (!calls.isIn(userId, params.id)) error(404, 'La llamada ya terminó');
	return sseResponse<CallEvent>(
		request,
		(listener) => calls.join(userId, params.id, device, listener) ?? (() => {})
	);
};
