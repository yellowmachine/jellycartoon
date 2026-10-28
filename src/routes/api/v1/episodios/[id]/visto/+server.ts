import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { clearProgress, saveProgress } from '#lib/server/progress.ts';

/** The video API (#253): an episode watched (`{ watched: true }`) or not, as in its series' page. */
export const POST: RequestHandler = async ({ request, params }) => {
	const person = await cloudPerson(request);
	const id = Number(params.id);
	const { watched } = await request.json().catch(() => ({}));
	if (!Number.isInteger(id) || typeof watched !== 'boolean') error(400, 'Petición no válida');
	if (watched) await saveProgress(person.id, id, 0, true);
	else await clearProgress(person.id, id);
	return json({ ok: true });
};
