import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProgress, saveProgress } from '#lib/server/music/progress.ts';
import { parseProgressSave } from 'comun/music.ts';

/** Where this person left each long audio without an album, to go on from there. */
export const GET: RequestHandler = async ({ locals }) =>
	json({ progress: await getProgress(locals.user!.id) });

/** From the browser that plays it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const save = parseProgressSave(await request.json().catch(() => null));
	if (!save) error(400, 'Posición no válida');
	if (!(await saveProgress(locals.user!.id, save))) error(404, 'Audio no encontrado');
	return json({ ok: true });
};
