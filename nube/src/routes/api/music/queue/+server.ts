import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { countListened } from '#lib/server/music.ts';
import { parseQueueSave } from 'comun/music.ts';

/**
 * The player's queue (comun's music-queue), saved every few seconds while it plays. Here it is not
 * kept, nor brought back: the house counts from it what is listened to, for Estadísticas (#421).
 */
export const GET: RequestHandler = () => json(null);

export const POST: RequestHandler = async ({ request, locals }) => {
	const queue = parseQueueSave(await request.json().catch(() => null));
	if (!queue) error(400, 'Cola no válida');
	try {
		await countListened(
			{ id: locals.user!.id, email: locals.user!.email },
			queue,
			locals.session!.id
		);
	} catch (problem) {
		// Without the house, or a house from before: the music goes on all the same.
		console.warn('[música] No se pudo contar lo escuchado', String(problem));
	}
	// No `savedAt`: nothing kept, nothing to clear when the player closes.
	return json({});
};
