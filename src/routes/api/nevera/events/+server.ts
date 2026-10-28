import type { RequestHandler } from './$types';
import { fridgeForScreen } from '#lib/server/kitchen.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { FridgeState } from 'comun/fridge.ts';

/** How often the TV asks the cloud for its fridge. */
const CLOUD_POLL_MS = 20_000;

/**
 * The fridge, live, for the TV (a child's included): the family's, in the cloud (#253), with the
 * agenda's «Hoy» (#200) on it, asked every little while as the cloud does not tell the house, and
 * sent when it changed. Without the cloud, empty.
 */
export const GET: RequestHandler = async ({ request }) =>
	sseResponse<FridgeState>(request, (listener) => {
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
		return () => clearInterval(every);
	});
