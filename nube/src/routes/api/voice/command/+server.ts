import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest, type VoiceReply } from 'comun/voice.ts';
import type { HouseVoiceOrder, VoiceTiming } from 'comun/house-voice.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { familyHasHouse, HouseProblem, tellHouse } from '#lib/server/house.ts';
import { describeTimersAt } from '#lib/server/alarms/alarms.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import {
	conversationOf,
	familySatellites,
	satelliteRequest,
	snapclientIdOf,
	snapserverOf
} from '#lib/server/satellites.ts';
import { voiceAnswered, voiceFailed } from '#lib/server/voice/alarm.ts';
import { KITCHEN_TOOLS, putOn, runVoiceCommand } from '#lib/server/voice/command.ts';
import { inQuietHours } from '#lib/server/voice/quiet-check.ts';
import { voiceSettings } from '#lib/server/voice/settings.ts';
import {
	HOUSE_DOWN,
	SATELLITE_WITHOUT_HOUSE,
	satelliteOrder
} from '#lib/server/voice/without-house.ts';

/** What a satellite cannot do: it has no screen, no kitchen, and «cuando hierva» needs one. */
const NOT_HERE = [
	'prepare_timer',
	...KITCHEN_TOOLS,
	'search_video',
	'series_episodes',
	'play_video',
	'send_clip'
];

/**
 * An order said to a satellite of Seilide's (#296), the house's path (its /api/voice/command): the
 * family's AI does it, in the house's name, with the satellite's timers kept here. With the house,
 * it opens the order for the satellite (its /api/v1/voz/orden: its music, its speakers), and its
 * hands do theirs; without it, or if it does not answer, without. Back, what to say; said, never an
 * error, when it cannot (no key, no credit).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	const place = `satelite:${satellite.id}` as const;
	const [timers, own, snapserver] = await Promise.all([
		describeTimersAt(k, place),
		familySatellites(k.familyId),
		snapserverOf(k, satellite.id)
	]);
	let fromHouse: HouseVoiceOrder | null = null;
	let note = SATELLITE_WITHOUT_HOUSE;
	/** How long the house took to open the order: none, without it. */
	let houseMs: number | null = null;
	if (await familyHasHouse(k.familyId))
		try {
			const asked = performance.now();
			fromHouse = await tellHouse<HouseVoiceOrder>(k.familyId, '/voz/orden', {
				...command,
				// Its own snapclient, if it plays the house's music: its room's speaker there.
				satellite: {
					id: satellite.id,
					name: satellite.name,
					speaker: snapserver ? snapclientIdOf(satellite.id) : null
				}
			});
			houseMs = Math.round(performance.now() - asked);
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			console.warn(`[voz] ${satellite.name}: sin la casa: ${err.message}`, {
				familyId: k.familyId
			});
			note = HOUSE_DOWN;
		}
	// Its timers are Seilide's; where alarms sound, its satellites and the house's (in its order).
	const satellites = [
		...own,
		...(fromHouse?.house.satellites ?? []).filter((h) => !own.some((o) => o.id === h.id))
	];
	const order = fromHouse
		? { ...fromHouse, request: command, house: { ...fromHouse.house, timers, satellites } }
		: satelliteOrder(command, satellite, timers, satellites);
	const started = performance.now();
	try {
		const { timing, ...reply } = await runVoiceCommand(
			k,
			order,
			NOT_HERE,
			fromHouse ? null : note,
			true,
			Boolean(fromHouse)
		);
		console.info(
			`[voz] ${satellite.name}: «${command.text}» → «${reply.reply}» · ${Math.round(performance.now() - started)} ms`,
			{
				familyId: k.familyId,
				// Where its time went, to study an order from the log alone.
				house: houseMs,
				prepare: timing.prepareMs,
				rounds: timing.rounds.map((r) => ({
					ms: r.ms,
					tools: r.tools.join(', ') || 'texto',
					prompt: r.prompt,
					cached: r.cached,
					completion: r.completion
				}))
			}
		);
		voiceAnswered(k.familyId);
		return json(
			(await keepsTalking(k, satellite.id, reply, timing))
				? { ...reply, conversation: true }
				: reply
		);
	} catch (err) {
		voiceFailed(k.familyId, err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] ${satellite.name}: «${command.text}»: ${message}`, {
			familyId: k.familyId
		});
		return json({
			reply: sayableError(message),
			actions: [],
			options: [],
			expectsAnswer: false
		} satisfies VoiceReply);
	}
};

/**
 * «Modo conversación» (#361): whether it listens after this answer, without the word. Not after a
 * question or something done by what was learned (they listen their own way), nor after putting
 * something on (it would hear that), nor in the «horas de silencio» (its beep).
 */
async function keepsTalking(
	k: Kitchen,
	id: string,
	reply: VoiceReply,
	timing: VoiceTiming
): Promise<boolean> {
	if (reply.expectsAnswer || reply.listenAfter || putOn(timing)) return false;
	if (!(await conversationOf(k, id))) return false;
	const { quiet } = await voiceSettings(k);
	const now = new Date();
	return !quiet || !inQuietHours(quiet, now.getHours() * 60 + now.getMinutes());
}
