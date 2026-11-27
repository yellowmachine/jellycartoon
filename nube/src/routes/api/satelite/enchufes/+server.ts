import { error, json } from '@sveltejs/kit';
import type { FoundPlug, PlugTaskResult } from 'comun/voice.ts';
import type { RequestHandler } from './$types';
import { plugTaskAnswered } from '#lib/server/plugs/setup.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/** At most this many found in one network: more is not a home. */
const MAX_FOUND = 100;

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null);

/** What it says it found, as far as it makes sense. */
function foundOf(list: unknown): FoundPlug[] {
	if (!Array.isArray(list)) return [];
	return list.slice(0, MAX_FOUND).flatMap((p) => {
		const deviceId = text(p?.deviceId, 100);
		const ip = text(p?.ip, 45);
		if (!deviceId || !ip) return [];
		return [
			{
				deviceId,
				ip,
				model: text(p.model, 100) ?? '',
				auth: p.auth === true,
				server: text(p.server, 500),
				relayed: p.relayed === true
			}
		];
	});
}

/** A satellite's answer to a plug task (#396): what it found, or what went wrong. */
export const POST: RequestHandler = async ({ request }) => {
	const { satellite } = await satelliteRequest(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = text(body?.id, 100);
	if (!id) error(400, 'Falta cuál');
	const result: PlugTaskResult = { id };
	if (body?.found !== undefined) result.found = foundOf(body.found);
	const problem = text(body?.problem);
	if (problem) result.problem = problem;
	// «abrir-alta» and «alta» (#643): its page, until when, and a device added.
	const url = text(body?.url, 100);
	if (url && /^http:\/\/[\d.]+:\d+\/alta$/.test(url)) result.url = url;
	if (typeof body?.until === 'number' && Number.isFinite(body.until)) result.until = body.until;
	const enrolled = body?.enrolled as Record<string, unknown> | undefined;
	const fp = text(enrolled?.fp, 30);
	const satelliteKey = text(enrolled?.satellite, 300);
	const ack = text(enrolled?.ack, 200);
	if (fp && satelliteKey && ack) result.enrolled = { fp, satellite: satelliteKey, ack };
	if (!plugTaskAnswered(satellite.id, result)) error(404, 'Esa tarea no es suya');
	return json({ ok: true });
};
