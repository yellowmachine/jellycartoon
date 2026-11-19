import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { watchNew } from '#lib/server/messages.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** Mensajes (#551), live: «hay algo nuevo» (never what), and the page asks for what is its own. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	return sseResponse<number>(request, (listener) => {
		// One at once: the page then asks for what came while it was not listening (and the stream
		// is open for the browser from the first byte).
		listener(Date.now());
		return watchNew(familyId, () => listener(Date.now()));
	});
};
