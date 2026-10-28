import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest } from 'comun/voice.ts';
import type { HouseVoiceOrder } from 'comun/house-voice.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { askHouse, HouseProblem } from '#lib/server/house.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';

/** What the road mode here does not have yet: the phone's timers. */
const NOT_HERE = ['set_timer', 'prepare_timer', 'cancel_timer'];

/**
 * What was said to the road mode (#253), done: the house opens the order with what only it knows
 * (its music, its tools; its /api/v1/voz/orden), in the name of who speaks, and the family's AI
 * does it here, as an order said at home. Back, what the device must do and what to answer.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	const k = await kitchenOf(locals.user!.id);
	let order: HouseVoiceOrder;
	try {
		order = await askHouse<HouseVoiceOrder>(locals.user!.id, locals.user!.email, '/voz/orden', {
			method: 'POST',
			body: JSON.stringify({ ...command, car: true })
		});
	} catch (err) {
		if (err instanceof HouseProblem) error(503, `Para la voz hace falta la casa: ${err.message}`);
		throw err;
	}
	const started = performance.now();
	try {
		const reply = await runVoiceCommand(k, order, NOT_HERE);
		console.info(
			`[voz] Carretera: «${command.text}» → «${reply.reply}» · ${Math.round(performance.now() - started)} ms`,
			{ familyId: k.familyId }
		);
		return json(reply);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] Carretera: «${command.text}»: ${message}`, { familyId: k.familyId });
		error(503, message);
	}
};
