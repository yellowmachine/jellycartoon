import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { snapcastEnabled, watchSnapcast } from '#lib/server/music/snapcast.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** What the music on Snapcast is doing, live. */
export const GET: RequestHandler = ({ request }) => {
	if (!snapcastEnabled) error(404, 'No hay Snapcast configurado (MUSIC_MPV_SOCKET)');
	return sseResponse(request, watchSnapcast);
};
