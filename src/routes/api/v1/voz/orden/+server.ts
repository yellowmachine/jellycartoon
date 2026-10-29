import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVoiceRequest } from 'comun/voice.ts';
import { cloudPerson, fromCloud } from '#lib/server/media-api.ts';
import { orderForCloudSatellite, orderFromCloud } from '#lib/server/voice/hands.ts';

/**
 * An order said to the cloud (#253: its road mode, or its Hablar), by one of the house; or to one of
 * the satellites it serves (#296: `satellite`, its id, name and own snapclient, and no one): what only the house
 * knows (its music, its tools), for the cloud's AI; the house's hands (/api/v1/voz) then answer to it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const command = parseVoiceRequest(body);
	if (!command) error(400, 'Orden no válida');
	const satellite = body?.satellite;
	if (satellite && typeof satellite === 'object') {
		await fromCloud(request);
		if (typeof satellite.id !== 'string' || typeof satellite.name !== 'string')
			error(400, 'Satélite no válido');
		const speaker = typeof satellite.speaker === 'string' ? satellite.speaker : null;
		const order = await orderForCloudSatellite(command, { ...satellite, speaker });
		if (!order) error(503, 'La casa aún no tiene ninguna cuenta');
		return json(order);
	}
	const person = await cloudPerson(request);
	return json(await orderFromCloud(command, person));
};
