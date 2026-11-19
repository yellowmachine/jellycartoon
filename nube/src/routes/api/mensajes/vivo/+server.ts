import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { watchNew } from '#lib/server/messages.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** Mensajes (#551), live: «hay algo nuevo» (never what), and the page asks for what is its own. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	return sseResponse<number>(request, (listener) => watchNew(familyId, () => listener(Date.now())));
};
