import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveProgress } from '#lib/server/progress.ts';
import { isKid } from '#lib/server/kids.ts';
import { videoAllowed } from '#lib/server/kid-time.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';
import { channelsFor } from '#lib/channels.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { episodeId, channelId, positionSec, durationSec } = await request.json();
	const userId = locals.user!.id;

	// A channel, live (LivePlayer): only a child's time, and out of it the player stops.
	if (channelId !== undefined) {
		const channel = channelsFor(isKid(locals.user)).find((c) => c.id === channelId);
		if (!channel || typeof positionSec !== 'number') error(400, 'Bad request');
		await addWatchTime(userId, { channelId: channel.id }, positionSec, locals.session!.id);
		if (!(await videoAllowed(userId)).allowed) error(403, 'Ahora no toca ver vídeos');
		return json({ ok: true });
	}

	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	await Promise.all([
		saveProgress(userId, episodeId, positionSec, completed),
		addWatchTime(userId, { episodeId }, positionSec, locals.session!.id)
	]);

	return json({ ok: true, completed });
};
