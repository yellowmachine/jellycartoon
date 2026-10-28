import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CORS, grantOf } from '#lib/server/media-api.ts';
import { saveProgress } from '#lib/server/progress.ts';

/**
 * The video API (#253): where the person is in the episode of the link, sent by the player every
 * few seconds, saved as in the app (/api/progress): it shows in «Seguir viendo» at home.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const grant = grantOf(params.token);
	const { positionSec, durationSec } = await request.json().catch(() => ({}));
	if (typeof positionSec !== 'number' || positionSec < 0) error(400, 'Falta positionSec');
	// Past 92% (end credits) counts as watched, as in the app.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	await saveProgress(grant.userId, grant.episodeId, positionSec, completed);
	return json({ ok: true, completed }, { headers: CORS });
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
