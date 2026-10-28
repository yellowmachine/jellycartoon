import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { djEnabled, startDjOnSnapcast, stopDjOnSnapcast } from '#lib/server/music/dj.ts';
import { snapcastEnabled } from '#lib/server/music/snapcast.ts';
import { parseDjOptions } from 'comun/music.ts';

/** Modo DJ on Snapcast, instead of whatever was on. */
export const POST: RequestHandler = async ({ request }) => {
	if (!(await djEnabled()) || !snapcastEnabled) error(404, 'No hay modo DJ en Snapcast');
	const options = parseDjOptions(await request.json());
	if (!options) error(400, 'Opciones no válidas');
	try {
		await startDjOnSnapcast(options);
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};

/** Out of Modo DJ: what is queued goes on, without the DJ. */
export const DELETE: RequestHandler = async () => {
	stopDjOnSnapcast();
	return json({ ok: true });
};
