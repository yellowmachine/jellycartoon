import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duck, mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { fromCloud } from '#lib/server/media-api.ts';
import { duckSpeaker } from '#lib/server/music/snapcast.ts';
import { allSatellites } from '#lib/server/satellites.ts';

/**
 * The living room lowered while someone speaks to one of the satellites Seilide serves (#296), as
 * to the house's (/api/salon/bajar): mpv, and its own Snapcast speaker if it was the house's.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	const { on, satellite } = await request.json().catch(() => ({}));
	if (typeof on !== 'boolean') error(400, 'Orden no válida');
	const speaker =
		typeof satellite === 'string'
			? ((await allSatellites()).find((s) => s.id === satellite)?.speakerId ?? null)
			: null;
	if (!mpvEnabled && !speaker) error(404, 'No hay mpv configurado');
	const failed = (
		await Promise.allSettled([
			mpvEnabled ? duck(on) : null,
			speaker ? duckSpeaker(speaker, on) : null
		])
	).find((r) => r.status === 'rejected');
	if (failed)
		error(503, failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
	return json({ ok: true });
};
