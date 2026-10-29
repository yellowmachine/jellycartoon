import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';
import { sseResponse } from '#lib/server/sse.ts';

/**
 * A satellite of Seilide's alarms and timers (#296), live, the house's path (its
 * /api/satelite/avisos): what rings where it is (in it or in the whole house), which its wake word
 * stops, and what it says itself. Again on every change.
 */
export const GET: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	return sseResponse<Awaited<ReturnType<typeof ringingFor>>>(request, (listener) => {
		const send = () =>
			void ringingFor(k, satellite.id)
				.then(listener)
				.catch((err) => console.warn('[avisos] Para el satélite', err));
		send();
		return watchAlarms(k.familyId, send);
	});
};
