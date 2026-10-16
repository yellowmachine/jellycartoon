import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveProgress } from '#lib/server/progress.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { episodeId, positionSec, durationSec } = await request.json();
	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	await Promise.all([
		saveProgress(locals.user!.id, episodeId, positionSec, completed),
		addWatchTime(locals.user!.id, { episodeId }, positionSec)
	]);

	return json({ ok: true, completed });
};
