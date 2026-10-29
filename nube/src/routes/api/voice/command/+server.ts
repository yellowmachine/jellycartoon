import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest, type VoiceReply } from 'comun/voice.ts';
import { describeTimersAt } from '#lib/server/alarms/alarms.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { allSatellites, satelliteRequest } from '#lib/server/satellites.ts';
import { voiceAnswered, voiceFailed } from '#lib/server/voice/alarm.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';
import { SATELLITE_WITHOUT_HOUSE, satelliteOrder } from '#lib/server/voice/without-house.ts';

/** What a satellite cannot do: it has no screen, no kitchen, and «cuando hierva» needs one. */
const NOT_HERE = [
	'prepare_timer',
	'kitchen_mode',
	'start_recipe',
	'cook_saved_recipe',
	'search_recipe_sites',
	'cook_from_web',
	'recipe_step',
	'end_recipe',
	'search_video',
	'series_episodes',
	'play_video',
	'send_clip'
];

/**
 * An order said to a satellite of Seilide's (#296), the house's path (its /api/voice/command): the
 * family's AI does it, in the house's name, with the satellite's timers kept here. Back, what to
 * say; said, never an error, when it cannot (no key, no credit).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	const place = `satelite:${satellite.id}` as const;
	const [timers, satellites] = await Promise.all([
		describeTimersAt(k, place),
		allSatellites(k.familyId)
	]);
	const order = satelliteOrder(command, satellite, timers, satellites);
	const started = performance.now();
	try {
		const { timing, ...reply } = await runVoiceCommand(
			k,
			order,
			NOT_HERE,
			SATELLITE_WITHOUT_HOUSE,
			true,
			false
		);
		console.info(
			`[voz] ${satellite.name}: «${command.text}» → «${reply.reply}» · ${Math.round(performance.now() - started)} ms`,
			{ familyId: k.familyId, rounds: timing.rounds.map((r) => r.tools.join(', ') || 'texto') }
		);
		voiceAnswered(k.familyId);
		return json(reply);
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
