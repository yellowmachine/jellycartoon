import type { RequestHandler } from './$types';
import { watchAgenda } from '#lib/server/agenda/agenda.ts';
import { fridgeState, kitchenOf, watchFridge } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from 'comun/fridge.ts';

/** The family's fridge, live: the whole of it on every change, its «Hoy» too (agenda.ts). */
export const GET: RequestHandler = async ({ request, locals }) => {
	const kitchen = await kitchenOf(locals.user!.id);
	return sseResponse<FridgeState>(request, (listener) => {
		const send = () => void fridgeState(kitchen).then(listener);
		send();
		const unwatch = [watchFridge(kitchen.familyId, send), watchAgenda(kitchen.familyId, send)];
		return () => unwatch.forEach((stop) => stop());
	});
};
