import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAlarmPlace } from 'comun/alarms.ts';
import { ringFromCloud } from '#lib/server/alarms/alarms.ts';
import { fromCloud } from '#lib/server/media-api.ts';

/**
 * One of the family's alarms whose time has come (#253), told by the cloud, which keeps them: it
 * rings here, where it is to sound, until someone stops it; or the music stops. Back, where it
 * sounds, for the phones' notice.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	const body = await request.json().catch(() => null);
	const id = Number(body?.id);
	const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 120) : '';
	const action = body?.action === 'parar_musica' ? 'parar_musica' : 'sonar';
	if (!Number.isInteger(id) || !label || !isAlarmPlace(body.place)) error(400, 'Aviso no válido');
	return json({ where: await ringFromCloud({ id, label, place: body.place, action }) });
};
