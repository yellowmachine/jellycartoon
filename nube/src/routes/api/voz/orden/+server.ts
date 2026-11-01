import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest } from 'comun/voice.ts';
import type { HouseVoiceOrder } from 'comun/house-voice.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { askHouse, hasHouse, HouseProblem } from '#lib/server/house.ts';
import { runVoiceCommand } from '#lib/server/voice/command.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { voiceAnswered, voiceFailed } from '#lib/server/voice/alarm.ts';
import { HOUSE_DOWN, NO_HOUSE, orderWithoutHouse } from '#lib/server/voice/without-house.ts';

/**
 * What the cloud does not do yet: video. Its timers, kept here (command.ts, `cloudTimer`), or with
 * the kitchen on (#60), the browser's.
 */
const NOT_HERE = ['search_video', 'series_episodes', 'play_video', 'send_clip'];

/** How its timers go, for the AI: the person's, or the kitchen's (#60). */
const TIMERS =
	'Con el modo cocina (o cocinando una receta), los temporizadores suenan en este aparato, también los preparados («cuando hierva»); si no, avisan en su móvil';

/** Away from the car, said to the AI: why those are not offered. */
const AWAY = `[Desde Seilide (Hablar): aquí no hay vídeo (series, películas, canales); eso está en jellycartoon, en casa. Si lo pide, díselo así, corto. ${TIMERS}, o suenan en casa si lo dice.]`;

/** The same without a house: nothing of it to send to. */
const AWAY_WITHOUT_HOUSE = `[Desde Seilide (Hablar): ${TIMERS}.]`;

/**
 * What was said to the cloud (#253), in its road mode or in Hablar, done: the house opens the order with what only it knows
 * (its music, its tools; its /api/v1/voz/orden), in the name of who speaks, and the family's AI
 * does it here, as an order said at home. Back, what the device must do and what to answer.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	const k = await kitchenOf(locals.user!.id);
	// Without the house (none, or it does not answer), Seilide makes the order itself, with nothing of it.
	let order: HouseVoiceOrder | null = null;
	let houseNote = NO_HOUSE;
	if (await hasHouse(locals.user!.id))
		try {
			order = await askHouse<HouseVoiceOrder>(locals.user!.id, locals.user!.email, '/voz/orden', {
				method: 'POST',
				body: JSON.stringify(command)
			});
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			console.warn(`[voz] Sin la casa: ${err.message}`, { familyId: k.familyId });
			houseNote = HOUSE_DOWN;
		}
	const withHouse = order !== null;
	order ??= orderWithoutHouse(command, locals.user!.name);
	const note = withHouse
		? command.car
			? null
			: AWAY
		: [command.car ? null : AWAY_WITHOUT_HOUSE, houseNote].filter(Boolean).join(' ');
	const started = performance.now();
	const where = `${command.car ? 'Carretera' : 'Hablar'}${withHouse ? '' : ', sin casa'}`;
	try {
		const reply = await runVoiceCommand(k, order, NOT_HERE, note, true, withHouse);
		console.info(
			`[voz] ${where}: «${command.text}» → «${reply.reply}» · ${Math.round(performance.now() - started)} ms`,
			{ familyId: k.familyId }
		);
		voiceAnswered(k.familyId);
		return json(reply);
	} catch (err) {
		voiceFailed(k.familyId, err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] ${where}: «${command.text}»: ${message}`, { familyId: k.familyId });
		error(503, sayableError(message));
	}
};
