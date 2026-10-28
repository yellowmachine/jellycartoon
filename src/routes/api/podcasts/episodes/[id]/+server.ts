import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { episodeToPlay, saveProgress } from '#lib/server/podcasts.ts';

/**
 * An episode to play now, from where this user left it; and where they are in it, from the browser
 * that plays it (`ended` at its end). The family's, in the cloud (#253): asked there.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const episode = await episodeToPlay(locals.user!.id, Number(params.id));
	if (!episode) error(404, 'Episodio no encontrado');
	return json(episode);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const positionSec = body?.positionSec;
	if (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0)
		error(400, 'Posición no válida');
	if (!(await saveProgress(locals.user!.id, Number(params.id), positionSec, body.ended === true)))
		error(404, 'Episodio no encontrado');
	return json({ ok: true });
};
