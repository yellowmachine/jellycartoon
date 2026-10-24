import type { RequestHandler } from './$types';
import { fridgeState, watchFridge } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from '#lib/fridge.ts';

/** The fridge (#131), live: the whole of it on every change. For the TV too, a child's included. */
export const GET: RequestHandler = async ({ request }) =>
	sseResponse<FridgeState>(request, (listener) => {
		const send = () => void fridgeState().then(listener);
		send();
		return watchFridge(send);
	});
