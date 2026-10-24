import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { chooseSeriesBackdrop } from '#lib/server/library/backdrop.ts';
import { log } from '#lib/server/log.ts';

/**
 * From the player: the frame at `atSec` of this episode, behind the top of its series' page from now
 * on. Back, the series, for its new image. Adults only (kids.ts).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const episodeId = Number(params.id);
	if (typeof body?.atSec !== 'number' || body.atSec < 0) error(400, 'Bad request');
	const [ep] = await db
		.select({ seriesId: episode.seriesId, durationSec: episode.durationSec })
		.from(episode)
		.where(eq(episode.id, episodeId));
	if (!ep) error(404, 'No encontrado');
	if (ep.durationSec && body.atSec > ep.durationSec) error(400, 'Momento no válido');
	try {
		await chooseSeriesBackdrop(ep.seriesId, { episodeId, atSec: body.atSec });
	} catch (problem) {
		log.warn('fondos', 'No se pudo cambiar el fondo de una serie', { episodeId, error: problem });
		error(500, 'No se pudo sacar el fondo');
	}
	return json({ seriesId: ep.seriesId });
};
