import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import {
	satelliteRequest,
	saysFor,
	snapclientIdOf,
	snapserverOf,
	watchSatellite
} from '#lib/server/satellites.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { satelliteVoiceOf, voiceKey } from '#lib/server/voice/satellite-voice.ts';

/**
 * A satellite of Seilide's alarms and timers (#296), live, the house's path (its
 * /api/satelite/avisos): what rings where it is (in it or in the whole house), which its wake word
 * stops, and what it says itself; what it is to say once (a rule's notice, #331, `say`); which
 * voice the family has (`voice`, for it to record its own phrases again only when it changes); and the
 * snapserver it plays from (Ajustes), for its own snapclient, with its name and its id there.
 * Again on every change.
 */
export const GET: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	type State = Awaited<ReturnType<typeof ringingFor>> & {
		snapserver: string | null;
		name: string;
		snapclientId: string;
		say: { id: string; text: string }[];
		voice: string;
	};
	return sseResponse<State>(request, (listener) => {
		const send = () =>
			void Promise.all([
				ringingFor(k, satellite.id),
				snapserverOf(k, satellite.id),
				satelliteVoiceOf(k)
			])
				.then(([ringing, snapserver, voice]) =>
					listener({
						...ringing,
						snapserver,
						name: satellite.name,
						snapclientId: snapclientIdOf(satellite.id),
						say: saysFor(satellite.id),
						voice: voiceKey(voice)
					})
				)
				.catch((err) => console.warn('[avisos] Para el satélite', err));
		send();
		const unwatch = [watchAlarms(k.familyId, send), watchSatellite(satellite.id, send)];
		return () => unwatch.forEach((u) => u());
	});
};
