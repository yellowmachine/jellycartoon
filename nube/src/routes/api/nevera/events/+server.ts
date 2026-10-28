import type { RequestHandler } from './$types';
import { fridgeState, kitchenOf, watchFridge } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from '#lib/fridge.ts';

/** The family's fridge, live: the whole of it on every change. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const kitchen = await kitchenOf(locals.user!.id);
	return sseResponse<FridgeState>(request, (listener) => {
		const send = () => void fridgeState(kitchen).then(listener);
		send();
		return watchFridge(kitchen.familyId, send);
	});
};
