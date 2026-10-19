import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { noteAsking, noteStopped } from '#lib/server/live-watching.ts';

/**
 * «¿Sigues ahí?» (#77) in this browser's player: asked, answered, or stopped for nobody answering,
 * for /infantil's «Ahora». The living room's mpv says it itself (cinema/mpv.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { state } = await request.json().catch(() => ({}));
	const userId = locals.user!.id;
	if (state === 'asking') noteAsking(userId, true);
	else if (state === 'answered') noteAsking(userId, false);
	else if (state === 'stopped') noteStopped(userId);
	else error(400, 'Bad request');
	return json({ ok: true });
};
