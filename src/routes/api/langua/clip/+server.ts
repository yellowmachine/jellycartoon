import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_CLIP_MINUTES, sendClip } from '#lib/server/langua.ts';

/**
 * «Mandar a Langua» from the player's menu: the last `minutes` of the episode up to where it is,
 * in the audio heard, as the voice's «manda los últimos 2 minutos a Langua» does. Its answer said.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const episodeId = Number(body?.episodeId);
	const positionSec = Number(body?.positionSec);
	const minutes = Number(body?.minutes);
	if (!Number.isInteger(episodeId) || !Number.isFinite(positionSec) || !(minutes > 0))
		error(400, 'Bad request');
	const message = await sendClip(locals.user!.id, {
		minutes: Math.min(minutes, MAX_CLIP_MINUTES),
		language: typeof body?.language === 'string' ? body.language : null,
		video: { episodeId, positionSec }
	});
	return json({ message });
};
