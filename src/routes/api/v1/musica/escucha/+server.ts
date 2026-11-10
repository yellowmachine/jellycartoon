import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { cloudViewer } from '#lib/server/media-api.ts';
import { addListenTime } from '#lib/server/music/listen-time.ts';
import { keepsHistory } from '#lib/server/settings.ts';
import { parseQueueSave } from 'comun/music.ts';

/**
 * The music API (#253): the queue Seilide's player saves every few seconds while it plays, only to
 * count the time listened to (#421), as this app's own (listen-time.ts); the queue itself is not
 * kept. `source`: Seilide's browser session, for two players at once not to mix.
 */
export const POST: RequestHandler = async ({ request }) => {
	const viewer = await cloudViewer(request);
	const body = await request.json().catch(() => null);
	const queue = parseQueueSave(body?.queue);
	const source = body?.source;
	if (!queue || typeof source !== 'string' || !source || source.length > 100)
		error(400, 'Cola no válida');
	const keeps = viewer.kid || (await isKidAccount(viewer.id)) || (await keepsHistory(viewer.id));
	await addListenTime(db, viewer.id, queue, `nube:${source}`, keeps);
	return json({ ok: true });
};
