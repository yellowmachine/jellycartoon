import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest } from 'comun/voice.ts';
import type { HouseVoiceOrder } from 'comun/house-voice.ts';
import { houseRequest } from '#lib/server/house-keys.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { voiceAnswered, voiceFailed } from '#lib/server/voice/alarm.ts';

/**
 * An order said in the house (#253): its voice sends what was said with what only it knows (its
 * music, what sounds, its speakers…), in the name of who spoke if they are of the family; back, the
 * answer to read aloud and what the device must do. What only the house can do, it is asked for
 * meanwhile (its /api/v1/voz).
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = (await request.json().catch(() => null)) as HouseVoiceOrder | null;
	const command = parseVoiceRequest(body?.request);
	const house = body?.house;
	if (
		!body ||
		!command ||
		typeof body.order !== 'string' ||
		!house ||
		!Array.isArray(house.library) ||
		!Array.isArray(house.tools)
	)
		error(400, 'Orden no válida');
	const started = performance.now();
	try {
		const reply = await runVoiceCommand(k, { ...body, request: command });
		console.info(
			`[voz] «${command.text}» → «${reply.reply}» · ${Math.round(performance.now() - started)} ms`,
			{ familyId: k.familyId, rounds: reply.timing.rounds.length }
		);
		voiceAnswered(k.familyId);
		return json(reply);
	} catch (err) {
		voiceFailed(k.familyId, err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] «${command.text}»: ${message}`, { familyId: k.familyId });
		error(503, sayableError(message));
	}
};
