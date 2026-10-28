import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { botHasGroup, sayInGroup, tellGroup } from '#lib/server/telegram/bot.ts';
import { isBotEvent } from '#lib/telegram-bot.ts';

/** The family's Telegram bot, for its house (jellycartoon, #243): whether it is in a group. */
export const GET: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	return json({ group: await botHasGroup(k.familyId) });
};

/**
 * What the house tells the family's group through the bot: one of its notices (`tell`, a timer
 * ringing), if the group hears that; or what its voice was asked to say there (`say`), with who or
 * where it comes from. Back, the group's name; a 400 with why, said for a person.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : '';
	if (!text) error(400, 'Falta el texto');
	switch (body.action) {
		case 'tell':
			if (!isBotEvent(body.event)) error(400, 'Aviso no válido');
			await tellGroup(k.familyId, body.event, text);
			return json({ ok: true });
		case 'say': {
			const from = typeof body.from === 'string' ? body.from.trim().slice(0, 80) : 'Casa';
			try {
				return json({ group: await sayInGroup(k.familyId, from, text) });
			} catch (err) {
				error(400, err instanceof Error ? err.message : String(err));
			}
		}
		default:
			error(400, 'Petición no válida');
	}
};
