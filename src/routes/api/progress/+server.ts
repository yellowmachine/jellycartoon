import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveProgress } from '#lib/server/progress.ts';
import { isKid } from '#lib/server/kids.ts';
import { videoAllowedTogether } from '#lib/server/kid-time.ts';
import { watchersOf } from '#lib/server/watching-together.ts';
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
	const sessionId = locals.session!.id;
	// Watching together (#160): their progress too, and the strictest of their limits.
	const watchers = isKid(locals.user) ? await watchersOf(userId, sessionId) : [userId];
	const allowed = async () => (await videoAllowedTogether(userId, sessionId)).allowed;
	// Where, as the page says it (its name in Ajustes, or «el móvil»…): for /infantil's «Ahora».
	const where =
		typeof device === 'string' && device.trim() ? device.trim().slice(0, 50) : 'un navegador';

	// A channel, live (LivePlayer): only a child's time, and out of it the player stops.
	if (channelId !== undefined) {
		const channel = channelsFor(isKid(locals.user)).find((c) => c.id === channelId);
		if (!channel || typeof positionSec !== 'number') error(400, 'Bad request');
		await addWatchTime(userId, { channelId: channel.id }, positionSec, sessionId, where);
		if (!(await allowed())) error(403, 'Ahora no toca ver vídeos');
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
			...watchers.map((id) => saveDmProgress(id, dailymotionId, positionSec, done)),
			addWatchTime(userId, { dailymotionId }, positionSec, sessionId, where)
		]);
		if (!(await allowed())) error(403, 'Ahora no toca ver vídeos');
		return json({ ok: true, completed: done });
	}

	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	await Promise.all([
		...watchers.map((id) => saveProgress(id, episodeId, positionSec, completed)),
		addWatchTime(userId, { episodeId }, positionSec, sessionId, where)
	]);

	return json({ ok: true, completed });
};
