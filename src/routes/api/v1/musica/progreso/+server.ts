import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { getProgress, saveProgress } from '#lib/server/music/progress.ts';
import { parseProgressSave } from 'comun/music.ts';

/** The music API (#253): where who listens in Seilide left each long audio without an album. */
export const GET: RequestHandler = async ({ request }) => {
	const viewer = await cloudViewer(request);
	return json({ progress: await getProgress(viewer.id) });
};

export const POST: RequestHandler = async ({ request }) => {
	const viewer = await cloudViewer(request);
	const save = parseProgressSave(await request.json().catch(() => null));
	if (!save) error(400, 'Posición no válida');
	if (!(await saveProgress(viewer.id, save))) error(404, 'Audio no encontrado');
	return json({ ok: true });
};
