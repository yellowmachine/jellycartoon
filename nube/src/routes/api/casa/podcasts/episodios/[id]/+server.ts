import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { episodeToPlay, saveProgress } from '#lib/server/podcasts/podcasts.ts';
import { personOnly } from '../../person.ts';

/** An episode to play in the house, from where the person asking left it. */
export const GET: RequestHandler = async ({ request, params }) => {
	const episode = await episodeToPlay(personOnly(await houseRequest(request)), Number(params.id));
	if (!episode) error(404, 'Episodio no encontrado');
	return json(episode);
};

/** Where they are in it, from the house's player; `ended` at its end. */
export const POST: RequestHandler = async ({ request, params }) => {
	const k = personOnly(await houseRequest(request));
	const body = await request.json().catch(() => null);
	const positionSec = body?.positionSec;
	if (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0)
		error(400, 'Posición no válida');
	if (!(await saveProgress(k, Number(params.id), positionSec, body.ended === true)))
		error(404, 'Episodio no encontrado');
	return json({ ok: true });
};
