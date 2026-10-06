import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { watchProgress } from '#lib/server/db/schema.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { episodeId, positionSec, durationSec } = await request.json();
	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched, and the next visit starts from zero.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	const values = {
		userId: locals.user!.id,
		episodeId,
		positionSec: completed ? 0 : positionSec,
		completed,
		updatedAt: new Date()
	};

	await db
		.insert(watchProgress)
		.values(values)
		.onConflictDoUpdate({ target: [watchProgress.userId, watchProgress.episodeId], set: values });

	return json({ ok: true });
};
