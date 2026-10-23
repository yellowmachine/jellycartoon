import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveProgress } from '#lib/server/progress.ts';
import { isKid } from '#lib/server/kids.ts';
import { videoAllowed } from '#lib/server/kid-time.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';
import { channelsFor } from '#lib/channels.ts';
import {
	dailymotionEnabled,
	knownVideo,
	saveProgress as saveDmProgress
} from '#lib/server/dailymotion.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { episodeId, channelId, dailymotionId, positionSec, durationSec, device } =
		await request.json();
	const userId = locals.user!.id;
	// Where, as the page says it (its name in Ajustes, or «el móvil»…): for /infantil's «Ahora».
	const where =
		typeof device === 'string' && device.trim() ? device.trim().slice(0, 50) : 'un navegador';

	// A channel, live (LivePlayer): only a child's time, and out of it the player stops.
	if (channelId !== undefined) {
		const channel = channelsFor(isKid(locals.user)).find((c) => c.id === channelId);
		if (!channel || typeof positionSec !== 'number') error(400, 'Bad request');
		await addWatchTime(userId, { channelId: channel.id }, positionSec, locals.session!.id, where);
		if (!(await videoAllowed(userId)).allowed) error(403, 'Ahora no toca ver vídeos');
		return json({ ok: true });
	}

	// A Dailymotion video (#66), one let through when its page opened: like an episode.
	if (dailymotionId !== undefined) {
		if (typeof dailymotionId !== 'string' || typeof positionSec !== 'number')
			error(400, 'Bad request');
		if (!dailymotionEnabled || !(await knownVideo(dailymotionId))) error(404, 'No encontrado');
		const done =
			typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
		await Promise.all([
			saveDmProgress(userId, dailymotionId, positionSec, done),
			addWatchTime(userId, { dailymotionId }, positionSec, locals.session!.id, where)
		]);
		if (!(await videoAllowed(userId)).allowed) error(403, 'Ahora no toca ver vídeos');
		return json({ ok: true, completed: done });
	}

	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	await Promise.all([
		saveProgress(userId, episodeId, positionSec, completed),
		addWatchTime(userId, { episodeId }, positionSec, locals.session!.id, where)
	]);

	return json({ ok: true, completed });
};
