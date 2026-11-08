import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { listPlugs, watchPlugs } from '#lib/server/plugs/plugs.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { PlugView } from '#lib/plugs.ts';

/** The family's plugs, live (#396): all of them whenever one changes. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { familyId } = await kitchenOf(userId);
	return sseResponse<PlugView[]>(request, (listener) => {
		const send = () => void listPlugs(userId).then(listener, () => {});
		send();
		return watchPlugs(familyId, send);
	});
};
