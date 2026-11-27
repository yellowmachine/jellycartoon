import { SATELLITE_CAN_HEADER, type DirectHearing, type PlugTask } from 'comun/voice.ts';
import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import { directHearing } from '#lib/server/house.ts';
import { plugTasksFor } from '#lib/server/plugs/setup.ts';
import { guardsFor, offeredRulesOf } from '#lib/server/plugs/satellite-rules.ts';
import { watchPlugs } from '#lib/server/plugs/plugs.ts';

/** Its plugs' guards, looked at again no sooner than this after a change (#651). */
const GUARDS_MS = 3000;
import type { PlugGuard } from 'comun/plug-rules.ts';
import type { OfferedPlugRules } from '#lib/server/db/voice.schema.ts';
import {
	languagesOf,
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
import { hearingLanguage } from '#lib/satellite-language.ts';
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
 * its network (`plugTasks`, #396), answered at /api/satelite/enchufes. And the plug rules it is
 * offered (`plugRules`, #651), signed by a device or said to it, and what stops each plug's
 * (`plugGuards`: padlock, pause, long heat).
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
		plugRules: OfferedPlugRules | null;
		plugGuards: Record<string, PlugGuard>;
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
				Promise.all([hearsByHouse(k), familyWords(k), languagesOf(k, satellite.id)])
					.then(([byHouse, words, { heard }]) =>
						byHouse
							? directHearing(
									k.familyId,
									satellite.id,
									heardPath(words, hearingLanguage(heard)),
									send
								)
							: null
					)
					.catch(() => null),
				offeredRulesOf(k, satellite.id).catch(() => null),
				guardsFor(k, satellite.id).catch(() => ({}))
			])
				.then(([ringing, snapserver, voice, hearing, plugRules, plugGuards]) =>
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
						plugTasks: plugTasksFor(satellite.id),
						plugRules,
						plugGuards
					})
				)
				.catch((err) => console.warn('[avisos] Para el satélite', err));
		send();
		// Its plugs' padlock, pause or long heat changed (#651): again, but only then; their watts
		// change every second, so looked at no more than every few seconds.
		let lastGuards = '';
		let guardTimer: ReturnType<typeof setTimeout> | null = null;
		void guardsFor(k, satellite.id)
			.then((g) => (lastGuards = JSON.stringify(g)))
			.catch(() => {});
		const guardsMaybe = () => {
			guardTimer ??= setTimeout(() => {
				guardTimer = null;
				void guardsFor(k, satellite.id)
					.then((g) => {
						const now = JSON.stringify(g);
						if (now === lastGuards) return;
						lastGuards = now;
						send();
					})
					.catch(() => {});
			}, GUARDS_MS);
		};
		const unwatch = [
			watchAlarms(k.familyId, send),
			watchSatellite(satellite.id, send),
			watchPlugs(k.familyId, guardsMaybe),
			satelliteHere(satellite.id, canAsk)
		];
		return () => {
			if (guardTimer) clearTimeout(guardTimer);
			unwatch.forEach((u) => u());
		};
	});
};
