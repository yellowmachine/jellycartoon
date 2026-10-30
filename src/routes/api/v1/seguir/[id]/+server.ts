import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { dismissProgress } from '#lib/server/progress.ts';

/** The video API (#253): out of «Seguir viendo»; where it was left is kept. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	const person = await cloudViewer(request);
	const id = Number(params.id);
	if (Number.isInteger(id)) await dismissProgress(person.id, id);
	return json({ ok: true });
};
