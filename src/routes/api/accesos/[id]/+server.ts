import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { videoAllowedTogether } from '#lib/server/kid-time.ts';
import { addWatchTime } from '#lib/server/watch-time.ts';
import { openableShortcut } from '#lib/server/tv-shortcuts.ts';

/**
 * A TV shortcut's window (#327), from the TV view: before opening it (`positionSec` 0), and every
 * few seconds while it is open and in front, the seconds it has been so. As a live channel's
 * player: a child's time (and those watching with it), and out of it, 403, and the window closes.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { positionSec, device } = await request.json();
	const id = Number(params.id);
	if (!Number.isInteger(id) || typeof positionSec !== 'number' || positionSec < 0)
		error(400, 'Bad request');
	const shortcut = await openableShortcut(id, isKid(locals.user));
	// Only a site's has a window (#343: the rest open in the TV view).
	if (!shortcut?.url) error(404, 'Not found');
	const userId = locals.user!.id;
	const sessionId = locals.session!.id;
	const where =
		typeof device === 'string' && device.trim() ? device.trim().slice(0, 50) : 'la tele';
	if (positionSec > 0)
		await addWatchTime(userId, { shortcutId: id }, positionSec, sessionId, where);
	const time = await videoAllowedTogether(userId, sessionId);
	if (!time.allowed) error(403, 'Ahora no toca ver vídeos');
	return json({ url: shortcut.url });
};
