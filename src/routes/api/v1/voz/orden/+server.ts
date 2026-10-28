import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest } from 'comun/voice.ts';
import { cloudPerson } from '#lib/server/media-api.ts';
import { orderFromCloud } from '#lib/server/voice/hands.ts';

/**
 * An order said to the cloud (#253: its road mode, or its Hablar), by one of the house: what only the house knows
 * (its music, its tools), for the cloud's AI; the house's hands (/api/v1/voz) then answer to it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	const command = parseVoiceRequest(await request.json().catch(() => null));
	if (!command) error(400, 'Orden no válida');
	return json(await orderFromCloud(command, person));
};
