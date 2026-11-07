import type { DirectHearing } from 'comun/voice.ts';
import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import { directHearing } from '#lib/server/house.ts';
import {
	satelliteRequest,
	saysFor,
	snapclientIdOf,
	snapserverOf,
	watchSatellite
} from '#lib/server/satellites.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { familyWords, heardPath } from '#lib/server/voice/heard-words.ts';
import { greetingsOf, satelliteVoiceOf, voiceKey } from '#lib/server/voice/satellite-voice.ts';

/**
 * A satellite of Seilide's alarms and timers (#296), live, the house's path (its
 * /api/satelite/avisos): what rings where it is (in it or in the whole house), which its wake word
 * stops, and what it says itself; what it is to say once (a rule's notice, #331, `say`); which
 * voice the family has (`voice`, for it to record its own phrases again only when it changes); what
 * it says on hearing its word instead of the beep (`greetings`, none for the beep); the word
 * itself (`wakeWord`, the same for all; none, each its own); and the snapserver it plays from (Ajustes), for its own snapclient, with its name and its id there.
 * And where it hears directly (`hearing`, #430), its house's Whisper, none to do it through here;
 * failing to know it never holds back what rings.
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
		greetings: string[];
		wakeWord: string | null;
		hearing: DirectHearing | null;
	};
	return sseResponse<State>(request, (listener) => {
		const send = () =>
			void Promise.all([
				ringingFor(k, satellite.id),
				snapserverOf(k, satellite.id),
				satelliteVoiceOf(k),
				familyWords(k)
					.then((words) => directHearing(k.familyId, satellite.id, heardPath(words), send))
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
						hearing
					})
				)
				.catch((err) => console.warn('[avisos] Para el satélite', err));
		send();
		const unwatch = [watchAlarms(k.familyId, send), watchSatellite(satellite.id, send)];
		return () => unwatch.forEach((u) => u());
	});
};
