import type { RequestHandler } from './$types';
import { fridgeState, watchFridge } from '#lib/server/fridge.ts';
import { cloudLink, fridgeForScreen } from '#lib/server/kitchen.ts';
import { watchAgenda } from '#lib/server/agenda/agenda.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from '#lib/fridge.ts';

/** How often the TV asks the cloud for its fridge. */
const CLOUD_POLL_MS = 20_000;

/**
 * The fridge (#131), live: the whole of it on every change, the agenda's «Hoy» (#200) too. For the
 * TV too, a child's included.
 */
export const GET: RequestHandler = async ({ request }) => {
	// In the cloud (#253): asked every little while, as the cloud does not tell the house; sent when
	// it changed. The agenda's «Hoy» on it, still the house's.
	if (await cloudLink())
		return sseResponse<FridgeState>(request, (listener) => {
			let last = '';
			const send = () =>
				void fridgeForScreen().then((state) => {
					const text = JSON.stringify(state);
					if (text === last) return;
					last = text;
					listener(state);
				});
			send();
			const every = setInterval(send, CLOUD_POLL_MS);
			const unwatch = watchAgenda(send);
			return () => {
				clearInterval(every);
				unwatch();
			};
		});
	return sseResponse<FridgeState>(request, (listener) => {
		const send = () => void fridgeState().then(listener);
		send();
		const unwatch = [watchFridge(send), watchAgenda(send)];
		return () => unwatch.forEach((stop) => stop());
	});
};
