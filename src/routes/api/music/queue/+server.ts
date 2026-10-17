import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tracksById } from '#lib/server/music/albums.ts';
import { clearQueue, getQueue, saveQueue } from '#lib/server/music/queue.ts';
import { parseQueueSave, type SavedQueue } from '#lib/music.ts';

/** What this user was playing, on whatever device, to go on with it; null if nothing. */
export const GET: RequestHandler = async ({ locals }) => {
	const queue = await getQueue(locals.user!.id);
	if (!queue) return json(null);
	const tracks = (await tracksById(queue.trackIds)).map((t) => t.track);
	if (!tracks.length && !queue.radioUuid) return json(null);
	// The one it was on, where it is now if some went away; the start of the next if it did.
	const currentId = queue.trackIds[queue.currentIndex];
	const index = tracks.findIndex((t) => t.id === currentId);
	return json({
		tracks,
		index: Math.max(index, 0),
		positionSec: index >= 0 ? queue.positionSec : 0,
		shuffle: queue.shuffle,
		repeat: queue.repeat,
		single: queue.single,
		radio: queue.radioUuid,
		changedBy: queue.changedBy,
		updatedAt: queue.updatedAt.toISOString()
	} satisfies SavedQueue);
};

/** From the browser that is playing it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const queue = parseQueueSave(await request.json().catch(() => null));
	if (!queue) error(400, 'Cola no válida');
	const savedAt = await saveQueue(locals.user!.id, queue);
	return json({ savedAt: savedAt.toISOString() });
};

/** The player was closed: its own save goes, not one from another device after it. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const since = new Date(url.searchParams.get('savedAt') ?? '');
	if (Number.isNaN(since.getTime())) error(400, 'Falta savedAt');
	await clearQueue(locals.user!.id, since);
	return json({ ok: true });
};
