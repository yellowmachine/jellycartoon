import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { tellStillThere } from '#lib/server/series.ts';

const STATES = ['here', 'asking', 'answered', 'stopped'] as const;

/**
 * «¿Sigues ahí?» (#77) in this browser's player: asked, answered, stopped for nobody answering, or
 * someone touching something (`here`). Passed on to the house, for /infantil's «Ahora».
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { state } = (await request.json().catch(() => null)) ?? {};
	if (!STATES.includes(state)) error(400, 'Bad request');
	try {
		await tellStillThere({ id: locals.user!.id, email: locals.user!.email }, state);
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
	return json({ ok: true });
};
