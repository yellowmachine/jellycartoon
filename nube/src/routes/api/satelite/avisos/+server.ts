import { SATELLITE_CAN_HEADER, type DirectHearing, type PlugTask } from 'comun/voice.ts';
import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import { directHearing } from '#lib/server/house.ts';
import { plugTasksFor } from '#lib/server/plugs/setup.ts';
import {
	satelliteHere,
	satelliteRequest,
	saysFor,
	snapclientIdOf,
	snapserverOf,
	watchSatellite
} from '#lib/server/satellites.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { familyWords, heardPath } from '#lib/server/voice/heard-words.ts';
import { hearsByHouse } from '#lib/server/voice/settings.ts';
import { greetingsOf, satelliteVoiceOf, voiceKey } from '#lib/server/voice/satellite-voice.ts';

/**
 * A satellite of Seilide's alarms and timers (#296), live, the house's path (its
 * /api/satelite/avisos): what rings where it is (in it or in the whole house), which its wake word
 * stops, and what it says itself; what it is to say once (a rule's notice, #331, `say`); which
 * voice the family has (`voice`, for it to record its own phrases again only when it changes); what
 * it says on hearing its word instead of the beep (`greetings`, none for the beep); the word
 * itself (`wakeWord`, the same for all; none, each its own); and the snapserver it plays from (Ajustes), for its own snapclient, with its name and its id there.
 * And where it hears directly (`hearing`, #430), its house's Whisper, none to do it through here;
 * failing to know it never holds back what rings. And the smart plugs it is to find or set up in
 * its network (`plugTasks`, #396), answered at /api/satelite/enchufes.
 * Again on every change. While open, it is there for «Compañía» (#469), which asks only those that
 * say they can (`SATELLITE_CAN_HEADER`): a `say` with `listen` is a question, its answer sent to
 * /api/satelite/compania.
 */
export const GET: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	type State = Awaited<ReturnType<typeof ringingFor>> & {
		snapserver: string | null;
		name: string;
		snapclientId: string;
		say: { id: string; text: string; listen?: boolean }[];
		voice: string;
		greetings: string[];
		wakeWord: string | null;
		hearing: DirectHearing | null;
		plugTasks: PlugTask[];
	};
	const canAsk = (request.headers.get(SATELLITE_CAN_HEADER) ?? '')
		.split(',')
		.map((c) => c.trim())
		.includes('compania');
	return sseResponse<State>(request, (listener) => {
		const send = () =>
			void Promise.all([
				ringingFor(k, satellite.id),
				snapserverOf(k, satellite.id),
				satelliteVoiceOf(k),
				// None when the family hears by OpenRouter always: then through here.
				Promise.all([hearsByHouse(k), familyWords(k)])
					.then(([byHouse, words]) =>
						byHouse ? directHearing(k.familyId, satellite.id, heardPath(words), send) : null
					)
					.catch(() => null)
			])
				.then(([ringing, snapserver, voice, hearing]) =>
					listener({
						...ringing,
						snapserver,
						name: satellite.name,
						snapclientId: snapclientIdOf(satellite.id),
						say: saysFor(satellite.id),
						voice: voiceKey(voice),
						greetings: greetingsOf(voice),
						wakeWord: voice.wakeWord,
						hearing,
						plugTasks: plugTasksFor(satellite.id)
					})
				)
				.catch((err) => console.warn('[avisos] Para el satélite', err));
		send();
		const unwatch = [
			watchAlarms(k.familyId, send),
			watchSatellite(satellite.id, send),
			satelliteHere(satellite.id, canAsk)
		];
		return () => unwatch.forEach((u) => u());
	});
};
