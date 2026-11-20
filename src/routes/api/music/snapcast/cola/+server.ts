import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { snapcastEnabled, snapcastQueue } from '#lib/server/music/snapcast.ts';

/**
 * Música → Cola on Snapcast: its queue in mpv's order now. Asked again by the page when the song
 * or the number of songs changes, not sent with every live state (a long queue weighs).
 */
export const GET: RequestHandler = async () => {
	if (!snapcastEnabled) error(404, 'No hay Snapcast configurado (MUSIC_MPV_SOCKET)');
	try {
		return json(await snapcastQueue());
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
};
