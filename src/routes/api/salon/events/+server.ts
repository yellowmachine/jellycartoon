import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mpvEnabled, watchRemote } from '#lib/server/cinema/mpv.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** What mpv in the living room is doing, live. */
export const GET: RequestHandler = ({ request }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado');
	return sseResponse(request, watchRemote);
};
