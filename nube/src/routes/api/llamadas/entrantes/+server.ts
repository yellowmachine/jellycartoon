import type { RequestHandler } from './$types';
import type { IncomingCall } from '#lib/calls.ts';
import { calls } from '#lib/server/calls.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** The calls ringing for this person, live (#330): for a page open in front of them, as Carretera. */
export const GET: RequestHandler = ({ request, locals }) =>
	sseResponse<IncomingCall[]>(request, (listener) =>
		calls.watchIncoming(locals.user!.id, listener)
	);
