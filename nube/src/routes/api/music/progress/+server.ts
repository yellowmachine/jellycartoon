import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { musicProgress, saveMusicProgress } from '#lib/server/music.ts';
import { parseProgressSave } from 'comun/music.ts';

/**
 * Where who listens left each long audio without an album (comun's track-progress), kept by the
 * house, as at home: it goes on from there here and there.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json({
			progress: await musicProgress({ id: locals.user!.id, email: locals.user!.email })
		});
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const save = parseProgressSave(await request.json().catch(() => null));
	if (!save) error(400, 'Posición no válida');
	try {
		await saveMusicProgress({ id: locals.user!.id, email: locals.user!.email }, save);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof HouseProblem) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
