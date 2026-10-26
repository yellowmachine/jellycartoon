import type { RequestHandler } from './$types';
import { fridgeState, watchFridge } from '#lib/server/fridge.ts';
import { watchAgenda } from '#lib/server/agenda/agenda.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from '#lib/fridge.ts';

/**
 * The fridge (#131), live: the whole of it on every change, the agenda's «Hoy» (#200) too. For the
 * TV too, a child's included.
 */
export const GET: RequestHandler = async ({ request }) =>
	sseResponse<FridgeState>(request, (listener) => {
		const send = () => void fridgeState().then(listener);
		send();
		const unwatch = [watchFridge(send), watchAgenda(send)];
		return () => unwatch.forEach((stop) => stop());
	});
