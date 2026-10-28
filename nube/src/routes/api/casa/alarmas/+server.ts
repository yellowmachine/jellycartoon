import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAlarmPlace } from 'comun/alarms.ts';
import { personOf } from '#lib/server/agenda/agenda.ts';
import { changeAlarmByVoice, setAlarmByVoice } from '#lib/server/agenda/voice.ts';
import { describeAlarms, stopAlarm } from '#lib/server/alarms/alarms.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

const isSatellites = (value: unknown): value is { id: string; name: string }[] =>
	Array.isArray(value) &&
	value.every((s) => s && typeof s.id === 'string' && typeof s.name === 'string');

/**
 * The family's alarms, for its house (jellycartoon, #241): for its voice, the list to go with each
 * order (`describe`, with the house's satellites to say where they sound), one set (`set`, where it
 * is said: `place`, a satellite's, or null) or changed (`change`); and one the house stopped
 * (`stopped`: «Parar» on its banner, «Alexa» on a satellite).
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const place = isAlarmPlace(body?.place) ? body.place : null;
	switch (body?.action) {
		case 'describe': {
			const me = place || !k.userId ? null : await personOf(k, k.userId);
			const satellites = isSatellites(body.satellites) ? body.satellites : [];
			return json({ lines: await describeAlarms(k, me, satellites) });
		}
		case 'set':
			return json({ say: await setAlarmByVoice(k, body.args ?? {}, place) });
		case 'change':
			return json({ say: await changeAlarmByVoice(k, body.args ?? {}, place !== null) });
		case 'stopped': {
			const id = Number(body.id);
			if (!Number.isInteger(id)) error(400, 'Petición no válida');
			await stopAlarm(k, id, { fromHouse: true });
			return json({ ok: true });
		}
		default:
			error(400, 'Petición no válida');
	}
};
